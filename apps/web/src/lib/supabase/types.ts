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
  sensitivity: number;
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
  telegram_chat_id: string | null;
  telegram_verified_at: string | null;
  locale: string;
  created_at: string;
};

/** id와 시각은 서버가 채운다. */
type ChannelInsert = Omit<ChannelRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
