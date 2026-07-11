export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string, code = 'BAD_REQUEST') {
  return new AppError(400, code, message);
}

export function unauthorized(message = '未登录或登录已过期') {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = '没有权限执行此操作') {
  return new AppError(403, 'FORBIDDEN', message);
}

export function notFound(message = '资源不存在') {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(message: string) {
  return new AppError(409, 'CONFLICT', message);
}
