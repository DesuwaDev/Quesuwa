export const fieldTypes = { short: '单行文本', long: '多行文本', single: '单选', multi: '多选', select: '下拉选择', file: '文件上传' };
export const statuses = ['待处理', '排查中', '已解决', '需要补充'];
export const choiceTypes = ['single', 'multi', 'select'];
export function bugTemplate() {
  const field = (id, type, label, required, description = '', options = []) => ({ id, type, label, required, description, options });
  return {
    title: '产品问题反馈', description: '约 1～2 分钟，不用登录。一次填写一个问题，按实际看到的情况描述就好。请勿提交密码、API Key，截图中的私人内容可以打码。',
    thanks: '谢谢你的反馈！我们会认真查看并优先处理影响使用的问题。',
    fields: [
      field('category', 'single', '哪里出了问题？', true, '', ['登录 / 注册', '功能使用', '导入 / 导出', '数据 / 保存', '设置 / 配置', '页面 / 卡顿 / 显示', '其他 / 不确定']),
      field('description', 'long', '当时做了什么，出现了什么问题？', true, '例如：点击保存后一直转圈，等了两分钟也没有成功提示。有报错请抄上；记得的话，也写一下发生的大概日期和时间。'),
      field('device', 'short', '你使用的设备和浏览器是？', true, '例如：苹果手机 Safari、安卓手机 Chrome、电脑 Edge、QQ 内打开。不知道可以写“不清楚”。'),
      field('frequency', 'single', '这个问题出现得频繁吗？', true, '', ['每次都会', '偶尔出现', '只遇到一次', '不确定']),
      field('clues', 'long', '有没有其他线索？', false, '可以写相关功能名称、页面地址，或者已经试过的办法。知道多少写多少。'),
      field('attachment', 'file', '截图或报错文件', false, '只上传与问题有关的内容，私人信息请打码。'),
      field('contact', 'short', '方便我们进一步联系你吗？', false, '可留 Discord、QQ 或邮箱中的一种。账号或保存问题也可留下产品内的用户名，不填也能提交。'),
    ],
  };
}
