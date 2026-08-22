export const CONTENT_STATUSES = [
  "DRAFT",
  "RECEIVING",
  "PROCESSING",
  "READY_FOR_REVIEW",
  "AWAITING_APPROVAL",
  "SCHEDULED",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "REJECTED",
  "FAILED",
  "NEEDS_REVIEW",
  "CANCELLED",
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const ACTIVE_CONTENT_STATUSES: ContentStatus[] = [
  "DRAFT",
  "RECEIVING",
  "PROCESSING",
  "FAILED",
];

export const CONTENT_ID_PATTERN = /^HC-\d{4}-\d{6}$/;

export const MAX_CONTENT_PHOTOS = 8;
export const MAX_CONTENT_PHOTO_BYTES = 8 * 1024 * 1024;

export type ContentAssetType = "ORIGINAL" | "ENHANCED" | "BRANDED" | "PUBLISHED";
export type ContentAssetRole =
  | "PRIMARY"
  | "SECONDARY"
  | "LOW_QUALITY"
  | "DUPLICATE"
  | "BEFORE"
  | "AFTER"
  | "";

export type ContentJob = {
  id: number;
  publicId: string;
  status: ContentStatus;
  description: string;
  serviceType: string;
  telegramChatId: string;
  telegramUserId: string;
  telegramStatusMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  lastError: string | null;
  pendingInput: string | null;
  recommendedPublishAt: string | null;
  recommendationReason: string | null;
  captionsJson: string;
  selectedCaption: string;
  mixType: string;
  contentType: string;
  ctaType: string;
  format: string;
  businessPriority: number;
  validUntil: string | null;
  sourceJobId: string;
};

export type ContentAsset = {
  id: number;
  jobId: number;
  publicId: string;
  version: number;
  assetType: ContentAssetType;
  role: ContentAssetRole;
  storedFilename: string;
  relativePath: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  telegramFileId: string | null;
  createdAt: string;
};

export type ContentVersion = {
  id: number;
  jobId: number;
  publicId: string;
  version: number;
  kind: "full" | "copy" | "image";
  copy: string;
  cta: string;
  hashtags: string;
  prompt: string;
  privacyNote: string;
  createdAt: string;
};
