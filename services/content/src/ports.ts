/** content 服务的端口 —— 契约收敛于 @core/contracts,此处仅 re-export */
import type { ArticleQueryPort, UserSummaryPort } from '@core/contracts';

/** content 序列化作者名只消费 UserSummaryPort 子集 */
export type UserQueryPort = UserSummaryPort;

export type { ArticleQueryPort };
