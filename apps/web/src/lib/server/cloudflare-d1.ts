import "server-only";

type D1Meta = {
  changed_db?: boolean;
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
};

type D1QueryResult<T> = {
  meta?: D1Meta;
  results?: T[];
  success?: boolean;
};

type D1Envelope<T> = {
  errors?: Array<{ message?: string }>;
  result?: Array<D1QueryResult<T>>;
  success?: boolean;
};

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }

  return value;
}

function getD1Endpoint() {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = getRequiredEnv("CLOUDFLARE_D1_DATABASE_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
}

function getD1Token() {
  return process.env.CLOUDFLARE_API_TOKEN ?? getRequiredEnv("DATABASE_AUTH_TOKEN");
}

export async function queryD1<T>(sql: string, params: unknown[] = []) {
  const response = await fetch(getD1Endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getD1Token()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
    cache: "no-store",
  });

  const payload = (await response.json()) as D1Envelope<T>;

  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join(" | ") || "D1 쿼리에 실패했습니다.";
    throw new Error(message);
  }

  const result = payload.result?.[0];
  if (!result || result.success === false) {
    throw new Error("D1 응답이 비어 있습니다.");
  }

  return {
    meta: result.meta ?? {},
    rows: result.results ?? [],
  };
}

export async function executeD1(sql: string, params: unknown[] = []) {
  const result = await queryD1(sql, params);
  return result.meta;
}
