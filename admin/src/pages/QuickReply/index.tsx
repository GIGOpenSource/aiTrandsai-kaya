import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from 'antd';
import LibraryTab from './LibraryTab';
import ConfigsTab from './ConfigsTab';

export default function QuickReplyPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('library');

  return (
    <div>
      <h2>{t('page.quickReply')}</h2>
      <p style={{ color: '#666', marginBottom: 12 }}>{t('quickReply.flowHint')}</p>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'library',
            label: t('quickReply.tabLibrary'),
            children: <LibraryTab />,
          },
          {
            key: 'configs',
            label: t('quickReply.tabConfigs'),
            children: <ConfigsTab />,
          },
        ]}
      />
    </div>
  );
}
