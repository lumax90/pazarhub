/** Independent visual-review accounts, registered by the isolated e2e server. */
export const nativeThemeOwners = {
  light: {
    name: 'Açık Tema Testi',
    workspaceName: 'Native Açık Tema Kabulü',
    email: 'native-theme-light@example.com',
    password: 'native-theme-e2e-password',
  },
  dark: {
    name: 'Koyu Tema Testi',
    workspaceName: 'Native Koyu Tema Kabulü',
    email: 'native-theme-dark@example.com',
    password: 'native-theme-e2e-password',
  },
} as const
