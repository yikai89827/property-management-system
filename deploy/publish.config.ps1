# 人工发布配置（本机路径，按需改）
$PublishConfig = @{
  # SSH 私钥
  PemPath   = 'D:\pms.pem'
  # 服务器
  Host      = '8.163.8.22'
  User      = 'root'
  # 远端项目目录
  RemoteDir = '/opt/pms'
  # 公网访问地址（仅用于发布结束提示）
  PublicUrl = 'http://www.ykbox.online'
}
