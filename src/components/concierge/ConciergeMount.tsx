"use client";

import { useEffect, useState } from "react";
import { ConciergeWidget } from "@/components/concierge/ConciergeWidget";

export function ConciergeMount() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void fetch("/api/concierge/chat")
      .then((res) => setEnabled(res.ok))
      .catch(() => setEnabled(false));
  }, []);
  if (!enabled) return null;
  return <ConciergeWidget />;
}
