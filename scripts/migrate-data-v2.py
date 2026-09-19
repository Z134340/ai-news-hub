#!/usr/bin/env python3
"""Offline migration: explicit new output + report, never in-place or under data/."""
import argparse
import json
from pathlib import Path
import sys
from contracts.data_v2 import encoded, migrate_document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    try:
        paths = [p.resolve() for p in (args.input, args.output, args.report)]
        if len(set(paths)) != 3:
            raise ValueError('Input, output and report must be different paths')
        protected = Path(__file__).resolve().parent.parent / 'data'
        for path in paths[1:]:
            if path.exists() or protected in path.parents:
                raise ValueError('Output/report must be new paths outside repository data/')
        document = json.loads(args.input.read_text(encoding='utf-8'))
        output, report = migrate_document(document)
        # Exclusive creation prevents accidental overwrite, including existing symlinks.
        with args.report.open('x', encoding='utf-8') as target:
            target.write(encoded(report))
        with args.output.open('x', encoding='utf-8') as target:
            target.write(encoded(output))
        print(f"Migrated; schema_errors={len(report['schema_errors'])}; needs_review={len(report['needs_review'])}; quarantine={len(report['quarantine'])}")
        return 2 if report['quarantine'] else 0
    except (OSError, ValueError) as error:
        print(f'Migration refused: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
