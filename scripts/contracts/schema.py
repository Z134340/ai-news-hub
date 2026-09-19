"""Offline evaluator for the JSON Schema vocabulary used by our checked-in schemas.

Not a general-purpose JSON Schema implementation. Unsupported keywords and external
references fail closed. Every schema is also usable by Draft 2020-12 validators.
"""
import json
import re
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parents[2] / 'schemas' / 'data' / 'v2'
KEYWORDS = {'$schema', '$id', '$ref', '$defs', 'title', 'description', 'type',
            'properties', 'required', 'additionalProperties', 'items', 'minItems',
            'minLength', 'minimum', 'pattern', 'format', 'enum', 'const',
            'allOf', 'anyOf', 'if', 'then', 'else'}

@lru_cache(maxsize=None)
def load_schema(name):
    if Path(name).name != name:
        raise ValueError('Only local schema filenames are allowed')
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding='utf-8'))
    check_schema(schema)
    return schema


def check_schema(schema):
    if isinstance(schema, bool):
        return
    unknown = set(schema) - KEYWORDS
    if unknown:
        raise ValueError(f'Unsupported schema keywords: {sorted(unknown)}')
    for key in ('properties', '$defs'):
        for value in schema.get(key, {}).values():
            check_schema(value)
    for key in ('items', 'additionalProperties', 'if', 'then', 'else'):
        if key in schema:
            check_schema(schema[key])
    for key in ('allOf', 'anyOf'):
        for value in schema.get(key, []):
            check_schema(value)
    ref = schema.get('$ref', '')
    if ref and (':' in ref or ref.startswith('/') or '..' in ref):
        raise ValueError('External schema references are forbidden')


def matches_type(value, kind):
    return {'object': isinstance(value, dict), 'array': isinstance(value, list),
            'string': isinstance(value, str), 'null': value is None,
            'boolean': isinstance(value, bool),
            'integer': isinstance(value, int) and not isinstance(value, bool),
            'number': isinstance(value, (int, float)) and not isinstance(value, bool)}[kind]


def errors(value, schema, path='$', root=None):
    root = schema if root is None else root
    if isinstance(schema, bool):
        return [] if schema else [f'{path}: not allowed']
    result = []
    if '$ref' in schema:
        filename, _, pointer = schema['$ref'].partition('#')
        target_root = load_schema(filename) if filename else root
        target = target_root
        for key in pointer.lstrip('/').split('/') if pointer else []:
            target = target[key.replace('~1', '/').replace('~0', '~')]
        result += errors(value, target, path, target_root)
    types = schema.get('type')
    if types and not any(matches_type(value, kind) for kind in (types if isinstance(types, list) else [types])):
        return result + [f'{path}: expected {types}']
    for keyword in ('const', 'enum'):
        if keyword not in schema:
            continue
        choices = [schema[keyword]] if keyword == 'const' else schema[keyword]
        if keyword in schema and not any(type(value) is type(c) and value == c for c in choices):
            result.append(f'{path}: invalid {keyword}')
    for child in schema.get('allOf', []):
        result += errors(value, child, path, root)
    if 'anyOf' in schema and not any(not errors(value, child, path, root) for child in schema['anyOf']):
        result.append(f'{path}: no anyOf alternative matches')
    if 'if' in schema:
        branch = 'else' if errors(value, schema['if'], path, root) else 'then'
        if branch in schema:
            result += errors(value, schema[branch], path, root)
    if isinstance(value, dict):
        result += [f'{path}.{key}: required' for key in schema.get('required', []) if key not in value]
        properties = schema.get('properties', {})
        for key, item in value.items():
            if key in properties:
                result += errors(item, properties[key], f'{path}.{key}', root)
            elif 'additionalProperties' in schema:
                result += errors(item, schema['additionalProperties'], f'{path}.{key}', root)
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0):
            result.append(f'{path}: too few items')
        for index, item in enumerate(value):
            if 'items' in schema:
                result += errors(item, schema['items'], f'{path}[{index}]', root)
    if isinstance(value, str):
        if len(value) < schema.get('minLength', 0):
            result.append(f'{path}: too short')
        if 'pattern' in schema and not re.search(schema['pattern'], value):
            result.append(f'{path}: pattern mismatch')
        if schema.get('format') == 'date':
            try:
                if date.fromisoformat(value).isoformat() != value:
                    raise ValueError()
            except ValueError:
                result.append(f'{path}: invalid date')
    if isinstance(value, str) and schema.get('format') == 'date-time':
        try:
            if (not re.fullmatch(r'\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})', value)
                    or datetime.fromisoformat(value.replace('t', 'T').replace('z', 'Z')).tzinfo is None):
                raise ValueError()
        except ValueError:
            result.append(f'{path}: invalid date-time')
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value < schema.get('minimum', float('-inf')):
        result.append(f'{path}: below minimum')
    return result
