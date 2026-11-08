package online.monkeycode.usdtsham;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "NativeNotify",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class NativeNotifyPlugin extends Plugin {

    public static final String CHANNEL_ID = "usdt_sham_alerts";
    private int nextId = 1101;

    @Override
    public void load() {
        ensureChannel();
    }

    private Uri alertSound() {
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        return sound;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "تنبيهات المنصة",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("صفقات وإيداع وسحب ورسائل الدعم");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 450, 180, 450, 180, 700 });
        channel.enableLights(true);
        channel.setSound(alertSound(), attrs);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(true);
        channel.setBypassDnd(false);
        nm.createNotificationChannel(channel);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        ensureChannel();
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < 33) {
            ret.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(ret);
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "onNotifyPermission");
    }

    @PermissionCallback
    private void onNotifyPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void show(PluginCall call) {
        ensureChannel();
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("notifications not granted");
            return;
        }
        String title = call.getString("title", "USDT شام");
        String body = call.getString("body", "");
        String href = call.getString("href", "/notifications");
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("href", href);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        int id = nextId++;
        PendingIntent pi = PendingIntent.getActivity(ctx, id, intent, flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
            .setSound(alertSound())
            .setVibrate(new long[] { 0, 450, 180, 450, 180, 700 })
            .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(ctx).notify(id, builder.build());
        } catch (SecurityException e) {
            call.reject("notifications not granted");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
