import { authApi } from './auth.js';
import { articlesApi } from './articles.js';
import { communityApi } from './community.js';
import { domainsApi } from './domains.js';
import { settingsApi } from './settings.js';
import { agentApi } from './agent.js';
import { annotationsApi } from './annotations.js';

export { ApiError, BASE, request, type PageResult } from './client.js';
export {
  setToken,
  getToken,
  getRefreshToken,
  setRefreshToken,
  setTokens,
  clearTokens,
} from './client.js';

/** 按域聚合的 API 客户端；各域实现见同目录子模块 */
export const api = {
  ...authApi,
  ...articlesApi,
  ...communityApi,
  ...domainsApi,
  ...settingsApi,
  ...agentApi,
  ...annotationsApi,
};
