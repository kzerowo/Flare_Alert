/*
 * 데이터베이스 스키마 타입.
 *
 * supabase/migrations/0001_init.sql 과 손으로 맞춘 것이다.
 * `supabase gen types` 로 뽑을 수도 있지만 그러려면 CLI와 프로젝트 연결이
 * 필요하다. 테이블이 셋뿐이라 지금은 손으로 두고, 스키마가 커지면 그때
 * 생성으로 바꾼다.
 *
 * 마이그레이션을 고치면 이 파일도 같이 고쳐야 한다. 어긋나면 타입은
 * 통과하는데 실행 중에 컬럼이 없다는 오류가 난다.
 *
 * interface가 아니라 type으로 쓴 것은 취향이 아니다. supabase-js는
 * 각 테이블이 Record<string, unknown>을 만족하길 요구하는데, interface는
 * 암묵적 인덱스 시그니처를 얻지 못해 이 제약을 통과하지 못한다.
 * 그러면 스키마 추론이 통째로 never로 무너지고, 오류는 엉뚱하게
 * "Property 'id' does not exist on type 'never'"로 나타난다.
 */

export type ChannelRow = {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  /** 민감도 슬라이더 위치 1~100. 0004 이전 행은 null일 수 있다. */
  sensitivity_level: number | null;
  /** @deprecated 다섯 칸이던 시절의 봉 길이. 0004에서 null 허용으로 바뀌었다. */
  scale: string | null;
  /** @deprecated 옛 백분위. 0003에서 null 허용으로 바뀌었다. */
  sensitivity: number | null;
  timeframes: string[];
  delivery: string[];
  created_at: string;
  updated_at: string;
};

export type ChannelSymbolRow = {
  channel_id: string;
  exchange: string;
  symbol: string;
};

export type ProfileRow = {
  id: string;
  locale: string;
  created_at: string;
};

export type PushSubscriptionRow = {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  label: string | null;
  created_at: string;
  last_success_at: string | null;
};

export type AlertRow = {
  id: string;
  user_id: string;
  channel_id: string;
  exchange: string;
  symbol: string;
  fired_at: string;
  price: number;
  percentile: number;
  score: number;
  quote_volume: number;
  ratio_to_median: number;
  scale: string;
  created_at: string;
};

/**
 * id와 시각은 서버가 채운다.
 *
 * scale과 sensitivity는 폐기 예정이라 넘기지 않는다. 둘 다 0004 이후로는
 * null을 허용하므로 생략해도 insert가 통과한다. sensitivity_level도 기본값
 * (60)이 있어 생략할 수 있다.
 */
type ChannelInsert = Omit<
  ChannelRow,
  | "id"
  | "created_at"
  | "updated_at"
  | "sensitivity_level"
  | "scale"
  | "sensitivity"
> & {
  id?: string;
  sensitivity_level?: number;
  scale?: string | null;
  sensitivity?: number | null;
};
type ChannelUpdate = Partial<Omit<ChannelRow, "id" | "user_id">>;

export type Database = {
  public: {
    Tables: {
      channels: {
        Row: ChannelRow;
        Insert: ChannelInsert;
        Update: ChannelUpdate;
        Relationships: [];
      };
      channel_symbols: {
        Row: ChannelSymbolRow;
        Insert: ChannelSymbolRow;
        Update: Partial<ChannelSymbolRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Pick<ProfileRow, "id"> & Partial<ProfileRow>;
        Update: Partial<Omit<ProfileRow, "id">>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Omit<PushSubscriptionRow, "created_at" | "last_success_at"> &
          Partial<Pick<PushSubscriptionRow, "last_success_at">>;
        Update: Partial<Omit<PushSubscriptionRow, "endpoint">>;
        Relationships: [];
      };
      alerts: {
        Row: AlertRow;
        // detector가 service_role로 넣는다. 웹은 읽기만 한다.
        Insert: Omit<AlertRow, "id" | "created_at"> & { id?: string };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // supabase/migrations/0005_delete_own_account.sql. 인자를 받지 않는다
      // — auth.uid()로만 지운다. 남의 계정을 지울 방법이 없어야 한다.
      delete_own_account: {
        Args: Record<PropertyKey, never>;
        Returns: void;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
