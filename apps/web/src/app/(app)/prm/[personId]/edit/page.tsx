import Link from "next/link";
import { notFound } from "next/navigation";

import { PersonPropertiesPanel } from "@/components/prm/person-properties-panel";
import { GlassCard } from "@/components/shared/glass-card";
import { PageBody, PageHeader, PageLayout } from "@/components/shared/page-layout";
import { getPRMPerson } from "@/lib/server/prm";
import type { PersonMock } from "@/lib/mock/prm";

function withoutSourceDocument(person: PersonMock): PersonMock {
  return { ...person, sourceDocument: undefined };
}

export default async function PersonEditPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const person = await getPRMPerson(personId);
  if (!person) notFound();

  return (
    <PageLayout>
      <PageHeader
        actions={
          <Link className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-white/8 hover:text-foreground" href={`/prm/${person.id}`} scroll={false}>
            관계 상세
          </Link>
        }
        description="노션 원본에서 넘어온 지저분한 관계 속성을 한 화면에서 정리합니다."
        eyebrow="관계 편집"
        title={`${person.name} 편집`}
      />
      <PageBody
        aside={
          <GlassCard priority="secondary">
            <p className="text-xs tracking-[0.08em] text-muted-foreground">편집 기준</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <p>기본 정보, 연락 리듬, 기념일, 연락처, 프로필 본문을 정규 속성으로 맞춥니다.</p>
              <p>원본 탭은 노션 컬럼을 기준 속성으로 옮길 때만 사용합니다.</p>
            </div>
          </GlassCard>
        }
        asideWidth="sm"
      >
        <PersonPropertiesPanel deferSourceDocument defaultMode="edit" person={withoutSourceDocument(person)} />
      </PageBody>
    </PageLayout>
  );
}
