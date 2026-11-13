package lu.andreasbraun.tabletoptrials;

import android.content.Context;
import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Screen orientation chosen in the game's options ("Screen: Auto / Portrait / Landscape"). The choice is kept in
// the app's preferences, so MainActivity starts in it straight away next time (no rotation at launch).
@CapacitorPlugin(name = "Orientation")
public class OrientationPlugin extends Plugin {
    static final String PREFS = "tabletop-trials";
    static final String KEY = "orientation";

    static int toRequested(String mode) {
        if ("portrait".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        if ("landscape".equals(mode)) return ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        // auto: follows the phone, and respects its own rotation lock
        return ActivityInfo.SCREEN_ORIENTATION_FULL_USER;
    }

    static String saved(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "auto");
    }

    @PluginMethod
    public void set(PluginCall call) {
        final String mode = call.getString("mode", "auto");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, mode).apply();
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(toRequested(mode)));
        call.resolve();
    }
}
