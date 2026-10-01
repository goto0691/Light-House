import { DataPortabilityClient } from "@/components/v2/data-portability-client";

export function PortabilityFixture() {
  return <main className="v2-product-shell v2-portability-fixture"><section className="v2-product-card v2-portability-page"><header><p>내 데이터는 앱보다 오래 남아야 합니다</p><h1>내보내기와 복원</h1><span>원본을 보존하고, 바뀔 내용을 먼저 확인한 뒤 명시적으로 실행합니다.</span></header><DataPortabilityClient initialJobs={[]} initialSnapshots={[]} /></section></main>;
}

