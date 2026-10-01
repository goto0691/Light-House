/** Build a balanced boolean tree from trusted SQL fragments. Long flat AND
 * chains become left-deep in SQLite and can exceed D1's expression depth when
 * nested inside ownership and immutable-source subqueries. Values stay bound. */
export function sqlConjunction(predicates: readonly string[]): string {
  if (predicates.length === 0) return "1";
  if (predicates.length === 1) return predicates[0];
  const middle = Math.floor(predicates.length / 2);
  return `(${sqlConjunction(predicates.slice(0, middle))} and ${sqlConjunction(predicates.slice(middle))})`;
}
