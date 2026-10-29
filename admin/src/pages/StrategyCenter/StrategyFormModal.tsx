import { Form, Input, InputNumber, Modal, Select, Switch } from 'antd';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { StrategyCenterRow, StrategyCenterTab } from '../../types';
import CompanionSearchSelect from '../Moments/CompanionSearchSelect';
import type { LibraryTypeSelectOption } from '../MsgStrategy/api';
import { senderModeExtra, TypeKeySelect } from '../MsgStrategy/shared';
import StrategyImageField from '../MsgStrategy/StrategyImageField';

type Mode = 'create' | 'edit' | 'view';

type Props = {
  open: boolean;
  mode: Mode;
  tab: StrategyCenterTab;
  saving?: boolean;
  row?: StrategyCenterRow | null;
  presetCompanionIds?: string[];
  langOptions: { value: string; label: string }[];
  typeOptions: LibraryTypeSelectOption[];
  onRefreshTypes?: () => void;
  onCancel: () => void;
  onOk: (values: Record<string, unknown>) => void;
};

export default function StrategyFormModal({
  open,
  mode,
  tab,
  saving,
  row,
  presetCompanionIds,
  langOptions,
  typeOptions,
  onRefreshTypes,
  onCancel,
  onOk,
}: Props) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const isQuick = tab === 'quick-reply';
  const readonly = mode === 'view';
  const companionLocked = mode !== 'create';
  const typeKeyWatch = Form.useWatch('type_key', form);
  const selectedType = typeOptions.find((item) => item.value === typeKeyWatch);

  useEffect(() => {
    if (!open) return;
    onRefreshTypes?.();
    if (mode === 'create') {
      form.resetFields();
      form.setFieldsValue({
        companion_ids: presetCompanionIds || [],
        language: 'zh',
        is_active: true,
        sort_order: 0,
        trigger_keyword: '',
        image_url: '',
      });
      return;
    }
    if (!row) return;
    form.setFieldsValue({
      content: row.content,
      image_url: row.image_url || '',
      language: row.language,
      type_key: row.type_key || row.trigger_event,
      companion_ids: row.companion_id ? [row.companion_id] : [],
      sort_order: row.sort_order ?? 0,
      is_active: row.is_active !== false,
      trigger_keyword: row.trigger_keyword || '',
    });
    // 打开时刷新类型；onRefreshTypes 由父组件稳定传入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, mode, open, presetCompanionIds, row]);

  const extraCompanionOptions = row?.companion_id
    ? [
        {
          value: row.companion_id,
          label: row.companion_name ? `${row.companion_name} (${row.companion_id})` : row.companion_id,
        },
      ]
    : (presetCompanionIds || []).map((id) => ({ value: id, label: id }));

  const title =
    mode === 'view' ? t('strategyCenter.view') : mode === 'edit' ? t('btn.edit') : t('btn.new');

  return (
    <Modal
      title={title as string}
      open={open}
      onCancel={onCancel}
      onOk={() => {
        if (readonly) {
          onCancel();
          return;
        }
        void form.validateFields().then(onOk);
      }}
      okText={readonly ? (t('btn.close') as string) : (t('btn.save') as string)}
      cancelButtonProps={readonly ? { style: { display: 'none' } } : undefined}
      confirmLoading={saving}
      destroyOnHidden
      width={640}
    >
      <Form form={form} layout="vertical" disabled={readonly}>
        <Form.Item
          name="content"
          label={isQuick ? t('strategyCenter.colContentQr') : t('strategyCenter.colContent')}
          rules={[{ required: true, message: t('strategyCenter.contentRequired') as string }]}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        {!isQuick ? (
          <Form.Item name="image_url" label={t('table.image')} extra={t('strategy.imageHint')}>
            <StrategyImageField disabled={readonly} />
          </Form.Item>
        ) : null}
        <Form.Item name="language" label={t('table.language')} rules={[{ required: true }]}>
          <Select options={langOptions} />
        </Form.Item>
        {isQuick ? (
          <Form.Item name="trigger_keyword" label={t('strategyCenter.colKeyword')} extra={t('strategyCenter.keywordHint')}>
            <Input placeholder={t('strategyCenter.colKeyword') as string} />
          </Form.Item>
        ) : (
          <Form.Item
            name="type_key"
            label={t('strategyCenter.colType')}
            rules={[{ required: true }]}
            extra={senderModeExtra(selectedType?.sender_mode, t)}
          >
            <TypeKeySelect
              options={typeOptions}
              onDropdownVisibleChange={(visible) => {
                if (visible) onRefreshTypes?.();
              }}
            />
          </Form.Item>
        )}
        <Form.Item
          name="companion_ids"
          label={t('strategyCenter.colCompanionQr')}
          extra={companionLocked ? t('strategyCenter.companionLocked') : undefined}
          rules={[{ required: true, type: 'array', min: 1, message: t('strategyCenter.companionRequired') as string }]}
        >
          <CompanionSearchSelect
            mode="multiple"
            disabled={companionLocked || readonly}
            extraOptions={extraCompanionOptions}
            placeholder={t('msgStrategy.companionIdsPlaceholder') as string}
          />
        </Form.Item>
        <Form.Item
          name="sort_order"
          label={isQuick ? t('strategyCenter.colSortOrder') : t('strategyCenter.colPriority')}
          extra={t('companionStrategies.sortOrderHint')}
        >
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="is_active" label={t('content.isActive')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
