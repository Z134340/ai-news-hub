#!/usr/bin/env python3
"""Cross-platform process lock; the OS releases the lock even after termination."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def run_locked(path, command):
    # Never unlink a flock inode: contenders must always open the same file.
    with Path(path).open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 75
        lock.seek(0)
        previous = lock.read().strip()
        if previous.isdigit() and int(previous) != os.getpid():
            try:
                os.kill(int(previous), 0)  # compatible with the old PID-only daily runner
                return 75
            except ProcessLookupError:
                pass
            except PermissionError:
                return 75
        lock.seek(0); lock.truncate(); lock.write(str(os.getpid())); lock.flush()
        child = None
        stopped = None
        stop_deadline = None
        def forward(sig, _frame):
            nonlocal stopped, stop_deadline
            if stopped is None:
                stopped = sig
                stop_deadline = time.monotonic() + 1
            if child and child.poll() is None:
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
        old = {sig:signal.signal(sig, forward) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            child = subprocess.Popen(command, start_new_session=True, pass_fds=(lock.fileno(),), env={**os.environ, 'ANH_DAILY_LOCK_HELD':'1'})
            while child.poll() is None:
                if stop_deadline is not None and time.monotonic() >= stop_deadline:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                try:
                    child.wait(timeout=0.1)
                except subprocess.TimeoutExpired:
                    pass
            code = child.returncode
            if stopped is not None:
                return 128 + stopped
            return code if code >= 0 else 128 - code
        finally:
            if child:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                    deadline = time.monotonic() + 1
                    while time.monotonic() < deadline:
                        time.sleep(0.05)
                        os.killpg(child.pid, 0)
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            for sig, handler in old.items():
                signal.signal(sig, handler)
            lock.seek(0); lock.truncate(); lock.flush()


if __name__ == '__main__':
    sys.exit(run_locked(sys.argv[1], sys.argv[2:]))
