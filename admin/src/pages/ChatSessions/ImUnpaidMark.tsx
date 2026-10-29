import { Tooltip } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { isImUnpaidMessage } from './imApi';

export function ImUnpaidMark({ msg }: { msg?: { send_status?: string | null } | null }) {
  const { t } = useTranslation();
  if (!isImUnpaidMessage(msg)) return null;
  return (
    <Tooltip title={t('im.unpaidHint')}>
      <ExclamationCircleFilled
        style={{ color: '#ff4d4f', fontSize: 16, flexShrink: 0, alignSelf: 'center' }}
        aria-label={t('im.unpaidHint') as string}
      />
    </Tooltip>
  );
}
