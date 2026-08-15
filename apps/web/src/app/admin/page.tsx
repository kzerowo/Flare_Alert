// 관리자 페이지.
//
// 본 화면(/)과 달리 채널·알림 저장소를 두지 않는다. 여기서 보는 것은
// 자기 채널이 아니라 전체 회원이고, 그 조회는 전부 RPC로 나간다.
// AuthProvider와 ProfileProvider만 있으면 된다.
//
// 접근 통제는 이 파일이 아니라 DB에 있다. admin_list_users / admin_set_plan /
// admin_stats 안의 is_admin() 검사가 실제 방어고, 화면의 권한 확인은
// 빈 표 대신 이유를 보여주기 위한 것이다(supabase/migrations/0006 참고).

import { AdminPage } from "@/components/AdminPage";
import { AuthProvider } from "@/lib/auth";
import { ProfileProvider } from "@/lib/profile";

export default function AdminRoute() {
  return (
    <AuthProvider>
      <ProfileProvider>
        <AdminPage />
      </ProfileProvider>
    </AuthProvider>
  );
}
