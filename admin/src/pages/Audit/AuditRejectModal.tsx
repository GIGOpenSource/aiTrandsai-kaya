import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Select, Input } from 'antd';
import { adminFetchJson } from '../../api/request';
import { getAppLanguage } from '../../locales';
import { unwrapResults } from '../Companions/contentApi';

const { TextArea } = Input;

export type ReportReason = {
  id: number;
  reason_code: string;
  label_zh: string;
  label_en: string;
  internal_action?: string;
  priority?: string;
};

type ReportReasonsResponse = {
  reasons?: ReportReason[];
};

let cachedReasons: ReportReason[] | null = null;
let loadingPromise: Promise<ReportReason[]> | null = null;

async function loadReportReasons(): Promise<ReportReason[]> {
  if (cachedReasons) return cachedReasons;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const res = await adminFetchJson<ReportReasonsResponse>('/api/companions/report-reasons');
      const raw = unwrapResults<ReportReasonsResponse>(res) ?? (res as ReportReasonsResponse | undefined);
      const list = Array.isArray(raw?.reasons) ? raw.reasons : [];
      cachedReasons = list;
      return list;
    } catch {
      return [];
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

export function AuditRejectModal({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (payload: { reason_id: number; remark: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const locale = getAppLanguage();
  const [reasonId, setReasonId] = useState<number | undefined>();
  const [remark, setRemark] = useState('');
  const [reasons, setReasons] = useState<ReportReason[]>(cachedReasons ?? []);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReasonId(undefined);
    setRemark('');
    setLoadingReasons(true);
    void loadReportReasons()
      .then(setReasons)
      .finally(() => setLoadingReasons(false));
  }, [open]);

  const options = useMemo(
    () =>
      reasons.map((item) => ({
        value: item.id,
        label: locale === 'en' ? item.label_en || item.label_zh : item.label_zh || item.label_en,
      })),
    [locale, reasons],
  );

  async function handleOk() {
    if (reasonId == null) return;
    setSubmitting(true);
    try {
      await onConfirm({ reason_id: reasonId, remark: remark.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={title ?? t('audit.rejectTitle')}
      open={open}
      onOk={() => void handleOk()}
      onCancel={onCancel}
      okText={t('btn.confirm') || 'OK'}
      cancelText={t('btn.cancel')}
      okButtonProps={{ danger: true, disabled: reasonId == null, loading: submitting }}
      destroyOnHidden
    >
      <p>{t('audit.rejectReasonSelectLabel')}</p>
      <Select
        style={{ width: '100%', marginBottom: 16 }}
        placeholder={t('audit.rejectReasonSelectPlaceholder')}
        options={options}
        value={reasonId}
        onChange={setReasonId}
        loading={loadingReasons}
        showSearch
        optionFilterProp="label"
      />
      <p>{t('audit.rejectRemarkLabel')}</p>
      <TextArea
        rows={3}
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder={t('audit.rejectRemarkPlaceholder')}
        maxLength={200}
        showCount
        style={{ marginBottom: 16 }}
      />
    </Modal>
  );
}
