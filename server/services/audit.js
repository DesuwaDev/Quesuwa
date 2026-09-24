export function createAudit(db) {
  const insert = db.prepare('INSERT INTO audit(action,target,detail,actor,created_at) VALUES (?,?,?,?,?)');
  const prune = db.prepare('DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)');
  return function audit(req, action, target = '', detail = '') {
    insert.run(action, String(target), String(detail).slice(0, 200), req?.user?.username || '', new Date().toISOString());
    prune.run();
  };
}
