export type Announcement = {
  version: string;
  title: string;
  message: string;
  publishedAt: number;
};

export const ANNOUNCEMENT_TITLE_LIMIT = 100;
export const ANNOUNCEMENT_MESSAGE_LIMIT = 2000;
