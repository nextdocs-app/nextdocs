import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import { ThemeSegmentedControl } from '../ThemeSegmentedControl';

export function PreferencesPanel() {
  return (
    <SettingsSection title="Appearance">
      <SettingsRow
        label="Theme"
        description="Choose a theme, or follow your system setting."
        control={<ThemeSegmentedControl />}
      />
    </SettingsSection>
  );
}
