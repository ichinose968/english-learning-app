package io.github.ichinose968.eng;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

  /**
   * ステータスバーとナビゲーションバーのアイコンを、明るいほう（白）に固定する。
   *
   * <p>このアプリは端末の設定によらず常にダークなので、地は必ず黒になる。ところが端末が
   * ライトモードだと、システムは「明るい地に置く前提」でアイコンを黒く描き、<b>黒いアプリの上で
   * 時計も電池も完全に見えなくなる</b>（エミュレータの実測で mLastAppearance=LIGHT_STATUS_BARS。
   * Web 側で踏んだ「黒地に黒で文字が消える」と同じ罠。docs 5章）。
   *
   * <p><b>テーマの windowLightStatusBar では直らない。</b> それも入れてあるが、Capacitor の
   * BridgeActivity が起動時にシステムバーの見た目を設定し直すので、あとから上書きされる。
   * ここが最後に効く場所なので、ここで決める。
   */
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
      getWindow(),
      getWindow().getDecorView()
    );
    controller.setAppearanceLightStatusBars(false);
    controller.setAppearanceLightNavigationBars(false);
  }
}
