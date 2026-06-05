# CovariantDataServey

一个用于浏览 forecasting covariate 时间序列数据集的轻量可视化项目。

在线展示：[GitHub Pages](https://kevin23-design.github.io/CovariantDataServey/)

## 内容

- `dataset/`：原始 CSV 数据集，使用 Git LFS 管理。
- `visualization/`：静态可视化页面，可直接部署到 GitHub Pages。
- `visualization/public/data/`：由原始数据预处理得到的 JSON 摘要数据。

## 可视化功能

- 时间序列浏览
- 季节性热力图
- 分布与箱线摘要
- 相关性矩阵
- 滞后相关
- 异常点查看
- 高维通道概览

## 数据集

当前包含 21 个 forecasting 数据集，包括 Electricity、Traffic、Weather、ETT、Exchange、PJM 等。

大文件通过 Git LFS 存储。首次克隆后如需完整 CSV，请确认已安装 Git LFS：

```bash
git lfs install
git lfs pull
```

## 本地预览

```bash
cd visualization
python -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000
```

## 部署

项目已配置 GitHub Actions。推送到 `main` 后，会自动将 `visualization/` 发布到 GitHub Pages。
