export const CAMPAIGN_ID_PATTERN = /^CM-\d{4}-\d{6}$/;
export const PIECE_ID_PATTERN = /^CP-\d{4}-\d{6}$/;

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PIECE_STATUSES = [
  "DRAFT",
  "READY",
  "AWAITING_APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "SIMULATED",
  "PUBLISHED",
  "PAUSED",
  "CANCELLED",
  "SCRIPT_READY",
] as const;
export type CampaignPieceStatus = (typeof PIECE_STATUSES)[number];

export const PIECE_PILLARS = ["discovery", "explain", "trust", "ask"] as const;
export type PiecePillar = (typeof PIECE_PILLARS)[number];

export const PIECE_FORMATS = ["SINGLE_IMAGE", "REEL_SCRIPT"] as const;
export type PieceFormat = (typeof PIECE_FORMATS)[number];

export type Campaign = {
  id: number;
  publicId: string;
  status: CampaignStatus;
  service: string;
  serviceSlug: string;
  zone: string;
  audience: string;
  problem: string;
  benefit: string;
  offer: string;
  objections: string;
  evidence: string;
  conversionChannel: string;
  objective: string;
  startsAt: string | null;
  endsAt: string | null;
  requestedHorizonDays: number;
  scheduledHorizonDays: number;
  scheduleNote: string;
  maxGeneration: number;
  generationUsed: number;
  experimentJson: string;
  approvalManifest: string;
  telegramChatId: string;
  createdAt: string;
  updatedAt: string;
  isTest: number;
};

export type CampaignPiece = {
  id: number;
  publicId: string;
  campaignId: string;
  status: CampaignPieceStatus;
  version: number;
  approvedVersion: number | null;
  pillar: PiecePillar;
  format: PieceFormat;
  objective: string;
  problem: string;
  hook: string;
  benefit: string;
  evidence: string;
  objection: string;
  visualNeed: string;
  copy: string;
  altCopy: string;
  overlayText: string;
  cta: string;
  altText: string;
  hypothesis: string;
  destinationUrl: string;
  whatsappUrl: string;
  contentJobId: string;
  scheduledAt: string | null;
  editorialScore: number;
  createdAt: string;
  updatedAt: string;
};
