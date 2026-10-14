export const pl = {
  settings: {
    users: {
      title: "Użytkownicy",
      autoLogin: "Automatyczne logowanie",
      autoLoginDescription:
        "Automatycznie zaloguj się jako ten użytkownik przy starcie",
      addUser: "Dodaj użytkownika",
      username: "Nazwa użytkownika (opcjonalnie)",
      userName: "Imię i nazwisko",
      roleVendor: "Vendor",
      create: "Utwórz użytkownika",
      delete: "Usuń użytkownika",
      deleteConfirm: "Czy na pewno chcesz usunąć tego użytkownika?",
      grants: "Uprawnienia",
      vendorNotice: "Uprawnień konta vendor nie można ograniczyć.",
      manageUsers: "Zezwól na zarządzanie użytkownikami",
      allowAllApps: "Zezwól na wszystkie aplikacje",
      allowAllSettings: "Zezwól na wszystkie ustawienia",
      appAccess: "Dostęp do aplikacji",
      settingsAccess: "Dostęp do ustawień",
      newPassword: "Nowe hasło",
      confirmPassword: "Potwierdź nowe hasło",
      setPassword: "Ustaw hasło",
      passwordMismatch: "Hasła nie są takie same",
      passwordUpdateFailed: "Nie udało się zmienić hasła",
      savePassword: "Zapisz hasło",
      current: "Aktualny",
      allowAllAppsDescription:
        "Przyznaj dostęp do każdej zainstalowanej aplikacji",
      allowAllSettingsDescription:
        "Przyznaj dostęp do wszystkich ustawień systemu",
      modeEasy: "Łatwy",
      modeRaw: "Surowy",
      appGrants: "Uprawnienia aplikacji",
      systemGrants: "Uprawnienia systemowe",
      rawWarning:
        "Uwaga: modyfikowanie surowych grantów może zepsuć dostęp do aplikacji.",
      filesystemLocation: "Ograniczenie do folderu",
      filesystemLocationPlaceholder:
        "Ścieżka względna, na przykład teams/operators",
      filesystemLocationHelp:
        "Ogranicza dostęp w katalogu domowym do tego folderu. Pozostaw puste, aby udostępnić całe wspólne drzewo. Użytkownicy mogą współdzielić ten sam folder lub foldery zagnieżdżone, np. projects i projects/design.",
      filesystemLocationUpdateFailed:
        "Nie udało się zaktualizować ograniczenia do folderu",
      filesystemLocationPickerFailed: "Nie udało się otworzyć wyboru folderu",
      filesystemLocationPickerTitle: "Wybierz dozwolony folder",
      chooseLocation: "Wybierz folder",
      vendorFilesystemDescription:
        "Użytkownicy vendor zawsze mają dostęp do całego systemu plików.",
    },
  },
} as const;
