import { Typography } from 'antd';
import { formatDate } from '../api/request';

type FormatDateProps = {
  value?: string | null;
  locale?: string;
};

/** 表格/详情时间展示：超长省略，悬停看完整 UTC 时间 */
export function FormatDate({ value, locale }: FormatDateProps) {
  const text = formatDate(value, locale);
  if (text === '-') return '-';
  return (
    <Typography.Text ellipsis={{ tooltip: text }} style={{ maxWidth: '100%', margin: 0 }}>
      {text}
    </Typography.Text>
  );
}
