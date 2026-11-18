package io.github.mungn0603code.gradplanner;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

// 로그인은 시스템 브라우저에서 하고(구글은 웹뷰 로그인을 막는다), 운영 주소로 돌아오면 앱 링크로 이 앱이 열린다.
// 그 주소를 웹뷰에 불러와 로그인을 마친다. 처음 실행 때도 BridgeActivity.load()가 이 메서드를 부른다
public class MainActivity extends BridgeActivity {
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent == null ? null : intent.getData();
        if (bridge != null && u != null && "https".equals(u.getScheme()) && "grad-planner-dusky.vercel.app".equals(u.getHost())) {
            bridge.getWebView().loadUrl(u.toString());
        }
    }
}
