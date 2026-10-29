import { useTranslation } from 'react-i18next';

export default function Dashboard() {
  const { t } = useTranslation();

  return (
    <div>
      <h2>{t('page.dashboard')}</h2>
    </div>
  );
}
