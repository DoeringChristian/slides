import type { JsonSchema } from './providers/types';

/**
 * Check a model-supplied tool input against the tool's schema.
 *
 * Tool inputs are untrusted model output, and with eager input streaming the
 * provider no longer validates them, so every input passes through here
 * before a tool runs. Covers the JSON Schema subset the deck tools use.
 * Returns a list of problems; empty means valid.
 */
export function validateInput(value: unknown, schema: JsonSchema, path = 'input'): string[] {
  if (schema.anyOf) {
    const results = schema.anyOf.map(option => validateInput(value, option, path));
    return results.some(r => r.length === 0) ? [] : [`${path}: matches none of the allowed shapes (${results.map(r => r[0]).join('; ')})`];
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    return [`${path}: must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`];
  }
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? [] : [`${path}: expected a string`];
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path}: expected a boolean`];
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected a number`];
      if (schema.type === 'integer' && !Number.isInteger(value)) return [`${path}: expected an integer`];
      if (schema.minimum !== undefined && value < schema.minimum) return [`${path}: must be ≥ ${schema.minimum}`];
      if (schema.maximum !== undefined && value > schema.maximum) return [`${path}: must be ≤ ${schema.maximum}`];
      return [];
    }
    case 'array': {
      if (!Array.isArray(value)) return [`${path}: expected an array`];
      if (!schema.items) return [];
      return value.flatMap((item, i) => validateInput(item, schema.items!, `${path}[${i}]`));
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected an object`];
      const record = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const key of schema.required ?? []) {
        if (record[key] === undefined) errors.push(`${path}.${key}: required`);
      }
      for (const [key, child] of Object.entries(record)) {
        const childSchema = schema.properties?.[key];
        if (childSchema) {
          if (child !== undefined) errors.push(...validateInput(child, childSchema, `${path}.${key}`));
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}.${key}: unknown property`);
        } else if (typeof schema.additionalProperties === 'object') {
          errors.push(...validateInput(child, schema.additionalProperties, `${path}.${key}`));
        }
      }
      return errors;
    }
    default:
      return [];
  }
}
