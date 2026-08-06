export const logger = {
  info: (msg: string, data?: any) => console.log(`[FeedWorker INFO] ${msg}`, data ? JSON.stringify(data) : ''),
  warn: (msg: string, data?: any) => console.warn(`[FeedWorker WARN] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg: string, error?: any) => console.error(`[FeedWorker ERROR] ${msg}`, error ? (error.stack || error) : ''),
  debug: (msg: string, data?: any) => console.debug(`[FeedWorker DEBUG] ${msg}`, data ? JSON.stringify(data) : ''),
};

