export function adminRequired(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ message: 'Chưa đăng nhập.' });
  }

  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ message: 'Chỉ admin được phép truy cập.' });
  }

  return next();
}
