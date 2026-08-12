/** community 服务端口 —— 契约收敛于 @core/contracts,此处仅 re-export 消费所需子集 */
import type { ArticleQueryPort, UserSummaryPort } from '@core/contracts';

export type UserQueryPort = UserSummaryPort;

export type { ArticleQueryPort };
