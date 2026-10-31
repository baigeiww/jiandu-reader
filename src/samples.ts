// Curated demo translations. Keys are paragraph IDs from the source paper.
export const samples: Record<string,string> = {
  'Sx2.SSx3.SSSx2.p1.1': 'EEG 预处理：使用 MNE-Python 工具箱 ⟦P0⟧ 对 EEG 数据进行预处理，以减少噪声并提高后续分析的信号质量。首先，采用 0.5–50 Hz 带通滤波去除缓慢漂移和高频噪声，随后使用 50 Hz 陷波滤波抑制工频干扰。之后，采用球面样条插值重建信号质量较差的通道。接着提取四类运动想象及静息态片段：每个运动想象片段长 25 秒，包括提示前 5 秒、运动想象执行期 10 秒和想象后静息期 10 秒；静息态片段长 60 秒。以提示出现前 ⟦P1⟧ 秒至 0 秒为基线进行校正，去除直流偏移。随后将采样率从 1000 Hz 降至 250 Hz，在保留与神经生理相关频率成分的同时降低计算负担。为进一步去噪，使用 MATLAB 中的 EEGLAB 工具进行独立成分分析（ICA），将 EEG 分解为 30 个独立成分。采用基于概率阈值的 ICLabel 自动分类工具，识别并剔除肌肉活动、眼动和通道噪声等伪迹成分。最后，将预处理后的 EEG 数据导出为 MATLAB 兼容的 ⟦P2⟧ 格式，用于后续解码和统计建模。',
  'Sx2.SSx3.SSSx2.p2.1': 'fNIRS 预处理：使用 MNE-Python 工具箱 ⟦P0⟧ 对 fNIRS 数据进行预处理，以减少噪声并提取可靠的血红蛋白浓度变化。首先，对原始信号施加三阶 Butterworth 带通滤波（0.02–0.2 Hz），去除缓慢漂移和高频噪声，同时保留任务相关的血流动力学波动。根据事件标记提取任务相关时间窗（例如刺激出现前后 ⟦P1⟧ 秒至 25 秒），并分割为单个试次，得到维度为“试次 ⟦P2⟧ 通道 ⟦P3⟧ 时间”的三维数据数组。以任务出现前 ⟦P4⟧ 秒至 0 秒为基线区间进行校正，以去除缓慢偏移和漂移。最后，将 fNIRS 数据降采样至 10 Hz，在保留生理意义信息的同时降低计算负担。将预处理后的 HbO 和 HbR 时间序列导出为 ⟦P5⟧ 格式，用于后续分析，形成支持后续分析和解码实验的完整 fNIRS 预处理流程。',
  'abstract1.1': '单侧肢体运动想象（MI）在上肢运动康复和外部设备的精确控制中发挥重要作用，并对空间分辨率提出了更高要求。然而，现有公开数据集大多采用左右肢体的二分类或四分类范式，主要利用较粗粒度的半球侧化差异；同时记录 EEG 与 fNIRS、面向单侧多方向运动想象的多模态数据集仍然不足。为此，我们构建了 MIND：一个基于右上肢四类方向运动想象范式的公开 fNIRS–EEG 数据集。该数据集包含 30 名参与者（12 名女性、18 名男性，年龄 19.0–25.0 岁）的 64 通道 EEG（1000 Hz）和 51 通道 fNIRS（47.62 Hz）记录。我们分析了 EEG 频谱功率和血流动力学响应的时空特征，并在分类准确率方面验证了混合 fNIRS–EEG 脑机接口的潜在优势。我们期望该数据集能促进神经影像分析与解码方法的评估和比较。',
  'Sx1.p5.1': '为弥补 EEG 空间分辨率的局限，我们设计了多模态 fNIRS–EEG 单侧上肢四类方向运动想象范式，并公开了名为 MIND（Motor Imagery fNIRS–EEG Dataset）的数据集。该数据集包含 30 名参与者的 EEG 与 fNIRS 记录。EEG 使用按国际 10–20 系统放置的 64 个电极记录，fNIRS 使用 51 个测量通道记录。每名参与者完成三个实验块（共六个 session）。每个 session 包含 60 秒静息态记录，以及两种单侧上肢运动想象条件下的试次，每次运动想象持续 10 秒。每名参与者共完成 120 个试次（每类 30 个），所有参与者合计产生 3,600 个 EEG 与 fNIRS 试次。',
};

export const headingLabels: Record<string,string> = {
  'Background & Summary':'背景与概述','Methods':'研究方法','Participants':'参与者',
  'Experimental Paradigm':'实验范式','Data collection and Preprocessing':'数据采集与预处理',
  'Data Records':'数据记录','Technical Validation':'技术验证','EEG Data Analysis':'EEG 数据分析',
  'fNIRS Data Analysis':'fNIRS 数据分析','fNIRS–EEG classification':'fNIRS–EEG 分类',
  'Code Availability':'代码可用性','References':'参考文献',
  'Data collection':'数据采集','Data preprocessing':'数据预处理',
};
