"use client";

import { useEffect, useRef, useState } from "react";
import { EditorWorkingCopyStore, type EditorRecoveryPolicyInput } from "@/lib/v2/editor/editor-working-copy";

/** Receives only authenticated policy metadata, including on a locked page. */
export function EditorRecoveryPolicy({ ownerId, recordId, currentVersion, privacyLevel }: EditorRecoveryPolicyInput) {
  const store = useRef(new EditorWorkingCopyStore());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void store.current.observeServerPolicy({ ownerId, recordId, currentVersion, privacyLevel })
      .then(() => { if (active) setFailed(false); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [ownerId, recordId, currentVersion, privacyLevel]);
  return failed ? <p className="v2-product-error" role="alert">이 기기의 편집 복구 사본 보호 설정을 적용하지 못했습니다. 다른 편집 창을 닫고 다시 확인해 주세요.</p> : null;
}
