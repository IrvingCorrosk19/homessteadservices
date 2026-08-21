import { marketingConfig, type IntentSignals } from "@/lib/marketing-config";

function known(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function homesteadIntentScore(signals: IntentSignals) {
  const weights = marketingConfig.intentWeights;
  const used: string[] = [];
  let score = 0;
  const add = (key: keyof typeof weights, value: number | null | undefined) => {
    if (!known(value)) return;
    score += weights[key] * value;
    used.push(key);
  };
  add("jobWon", signals.jobWon);
  add("qualifiedLead", signals.qualifiedLead);
  add("lead", signals.lead);
  add("whatsappClick", signals.whatsappClick);
  add("dm", signals.dm);
  add("callClick", signals.callClick);
  add("contactClick", signals.contactClick);
  add("profileVisit", signals.profileVisit);
  add("linkClick", signals.linkClick);
  add("share", signals.share);
  add("save", signals.save);
  add("comment", signals.comment);
  add("follow", signals.follow);
  add("like", signals.like);
  add("impression", signals.impression);
  const reach = known(signals.reach) ? signals.reach : known(signals.impression) ? signals.impression : null;
  const intentPerReach = reach && reach > 0 ? score / reach : null;
  return {
    score: used.length ? Math.round(score * 100) / 100 : null,
    intentPerReach,
    usedSignals: used,
    unknown: used.length === 0,
  };
}
