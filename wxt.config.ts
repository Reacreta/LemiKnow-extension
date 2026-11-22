import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  manifest: {
    name: 'LemiKnow — Client-Side Data Lineage & Risk Sensor',
    short_name: 'LemiKnow',
    description:
      'User-initiated passive telemetry collector for observable client-side third-party dependency mapping.',
    version: '1.0.0',
    permissions: ['webRequest', 'storage', 'activeTab', 'tabs'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'LemiKnow Sensor',
    },
  },
});