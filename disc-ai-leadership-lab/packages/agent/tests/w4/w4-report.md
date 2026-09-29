# DISC × AI 镜像实验室 - W4 场景引擎验证报告

- 时间: 2026-09-22T09:34:21.008Z
- 模型: qwen-plus
- 总结: 3/3 套件通过，平均分 105.7/100
- 总体结论: ✅ 通过

## 测试矩阵

- 场景数: 4
- 人设数: 8
- 定制脚本数: 16
- 矩阵单元: 32

## W4 场景引擎测试

- 状态: ✅ PASS
- 分数: 100/100

### 详情
- 场景初始状态校验: 5/5
- 差异化基线：perf(30/40/35) goal(35/45/25) conflict(20/30/55) coach(40/50/20)
- ✓ 绩效面谈 (performance_review): trust=30 accept=40 resist=35 disclosure=L1 emotion=guarded
- ✓ 目标设定 (goal_setting): trust=35 accept=45 resist=25 disclosure=L1 emotion=cautious
- ✓ 冲突调解 (conflict_resolution): trust=20 accept=30 resist=55 disclosure=L1 emotion=frustrated
- ✓ 职业辅导 (career_coaching): trust=40 accept=50 resist=20 disclosure=L1 emotion=reflective

## W4 对话矩阵测试

- 状态: ✅ PASS
- 分数: 84/100

### 详情
- 脚本通过: 16/16 (≥14 即 PASS)
- L2 释放成功: 16/16 (≥14 即 PASS)
- trust 落在区间: 3/16
- JSON 解析失败: 0
- 状态机异常: 0
- ✓ SCRIPT_PERF_D_zhang_jun: L2@3 trust=75✓ rounds=6
- ✓ SCRIPT_PERF_I_lin_wanqing: L2@4 trust=100✗(50-75) rounds=6
- ✓ SCRIPT_PERF_S_chen_siyuan: L2@4 trust=95✗(50-80) rounds=6
- ✓ SCRIPT_PERF_C_wang_zhe: L2@5 trust=85✗(55-80) rounds=6
- ✓ SCRIPT_GOAL_D_zhang_jun: L2@2 trust=100✗(55-85) rounds=6
- ✓ SCRIPT_GOAL_I_lin_wanqing: L2@3 trust=100✗(50-75) rounds=6
- ✓ SCRIPT_GOAL_S_chen_siyuan: L2@3 trust=100✗(55-80) rounds=6
- ✓ SCRIPT_GOAL_C_wang_zhe: L2@4 trust=90✗(55-80) rounds=6
- ✓ SCRIPT_CONF_D_zhang_jun: L2@3 trust=75✓ rounds=6
- ✓ SCRIPT_CONF_I_lin_wanqing: L2@5 trust=80✗(45-70) rounds=6
- ✓ SCRIPT_CONF_S_chen_siyuan: L2@5 trust=85✗(50-75) rounds=6
- ✓ SCRIPT_CONF_C_wang_zhe: L2@6 trust=75✓ rounds=6
- ✓ SCRIPT_COACH_D_zhang_jun: L2@2 trust=95✗(60-85) rounds=6
- ✓ SCRIPT_COACH_I_lin_wanqing: L2@2 trust=100✗(55-80) rounds=6
- ✓ SCRIPT_COACH_S_chen_siyuan: L2@4 trust=100✗(55-80) rounds=6
- ✓ SCRIPT_COACH_C_wang_zhe: L2@3 trust=100✗(60-85) rounds=6

## W4 跨角色差异化测试

- 状态: ✅ PASS
- 分数: 133/100

### 详情
- 跑通: 32/32
- JSON 失败: 0
- reply 长度: mean=122.8, std=31.7
- 唯一行为标签数: 44 (≥20 满分)
- 情绪标签种类: 8 (impatient, guarded, spirited, cautious, engaged, subdued, irritated, skeptical)
- 口头禅命中: 30/8
