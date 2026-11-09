package online.monkeycode.usdtsham;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "NativeBiometric")
public class NativeBiometricPlugin extends Plugin {

    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG
        | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            int status = BiometricManager.from(getContext()).canAuthenticate(AUTH);
            ret.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
            ret.put("status", status);
        } catch (Exception e) {
            ret.put("available", false);
            ret.put("status", -1);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        call.setKeepAlive(true);
        getActivity().runOnUiThread(() -> {
            try {
                FragmentActivity activity = (FragmentActivity) getActivity();
                Executor executor = ContextCompat.getMainExecutor(activity);
                String title = call.getString("title", "قفل التطبيق");
                String subtitle = call.getString("subtitle", "استخدم البصمة أو الوجه للمتابعة");
                String cancel = call.getString("cancel", "إلغاء");
                BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            call.reject(errString != null ? errString.toString() : "تعذر التحقق بالبصمة");
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            JSObject ret = new JSObject();
                            ret.put("ok", true);
                            call.resolve(ret);
                        }
                    }
                );
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText(cancel)
                    .setAllowedAuthenticators(AUTH)
                    .build();
                prompt.authenticate(info);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "تعذر فتح نافذة البصمة");
            }
        });
    }
}
