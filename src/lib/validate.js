// 快照校验（docs/DESIGN.md §5.4）
export function validate(snapshot, rows) {
  const errors = [];
  if (rows.length !== snapshot.total) {
    errors.push(`行数 ${rows.length} != total ${snapshot.total}`);
  }
  const ids = new Set();
  let prev = 0;
  for (const r of rows) {
    if (!r.sire || !r.sire.id) {
      errors.push("缺马ID: " + JSON.stringify(r.sire));
      continue;
    }
    if (ids.has(r.sire.id)) errors.push("重复马ID: " + r.sire.id);
    ids.add(r.sire.id);
    if (!/^\d{10}$/.test(r.sire.id)) errors.push("ID格式异常: " + r.sire.id);
    if (r.rank < prev) errors.push("顺位逆序: " + r.rank);
    prev = r.rank; // 允许并列（非严格递增）
  }
  return errors;
}
