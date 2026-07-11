/** 与 api.ts 共享 token 读写，避免循环依赖 */
export function getToken(): string | null {
  return localStorage.getItem('agentforge-token');
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem('agentforge-token', token);
  else localStorage.removeItem('agentforge-token');
}
