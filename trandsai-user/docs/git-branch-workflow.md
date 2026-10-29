# 分支怎么用（SourceTree + 终端）

仓库：https://gitee.com/dai-jiaying/ai-girlfriend  
本地目录：`aiGrilFriend_new`

当前约定（1.5.1 正式版测试期间）：

| 名称 | 干什么 |
|------|--------|
| `master` | 主线。测试期间**不要**在这写新功能、也不要在这修这期 bug |
| `release/test` | **正式版测试冻结**。测试提的 bug **只在这条上改** |
| `feature/next` | **新需求**。测试测很久的时候，你在这条上继续开发 |
| `v1.5.1` | 标签，钉死这次测试包对应的代码，不会跟着分支往前走 |

三条分支一开始指向同一份代码。之后你在不同分支上提交，它们才会分叉。

**不要提交 `.env`**（里面是本地/密钥配置）。

---

## 1. 先搞清楚：你现在站在哪条分支

所有「提交、推送、拉取」都作用在**当前分支**上。推错分支 = 新功能进了测试线，或 bug 修在新需求线上。

**终端：**

```bash
cd /Users/ww/project/aiGrilFriend_new
git branch -vv
```

前面有 `*` 的就是当前分支。

**SourceTree：**

1. 打开这个仓库。
2. 左侧 **BRANCHES**（分支）里，**加粗 / 高亮** 的就是当前分支。
3. 窗口顶部也会显示当前分支名。

---

## 2. 切换分支（去写新需求 / 去修测试 bug）

切分支前：改过的文件要么先**提交**，要么先 **stash（暂存）**。否则 SourceTree / Git 可能不让你切走，或切走时把未提交改动带过去搞混。

### 终端

```bash
# 去写新需求
git checkout feature/next

# 去修测试提的 bug
git checkout release/test

# 看主线（一般只看，少改）
git checkout master
```

如果提示有未提交改动，先处理（见第 4、5 节），再切。

### SourceTree

1. 左侧点目标分支（例如 `feature/next`）。
2. 双击该分支，或右键 → **Checkout**（检出）。
3. 成功后左侧该分支变为当前分支，工作区文件会变成这条分支上的内容（感觉「代码变回去了」是正常的）。

---

## 3. 从 Gitee 拉代码（别人推了 / 你另一台电脑改了）

拉的是**当前分支**在远程上的更新。

### 终端

```bash
# 建议先确认当前分支
git branch

# 只拉当前分支
git pull

# 想把远程新分支、标签都更新到本地（换电脑后常用）
git fetch origin
git checkout feature/next
git pull
```

换电脑第一次，远程已有分支、本地还没有时：

```bash
git fetch origin
git checkout feature/next      # 会自动跟踪 origin/feature/next
git checkout release/test
```

### SourceTree

1. 先检出你要更新的那条分支（双击 `feature/next` 或 `release/test`）。
2. 顶部点 **Pull**（拉取）。
3. 默认勾选当前分支即可，点 **OK / 确定**。

如果左侧看不到远程新分支：顶部 **Fetch**（获取）一次，再在左侧 **Remotes → origin** 里找，右键 **Checkout**。

---

## 4. 提交代码（commit，还在你电脑上）

提交 = 在**当前分支**记一笔快照。这时 Gitee 上还没有，必须再 **Push（推送）**。

### 终端

```bash
git status                          # 看改了哪些文件
git add 某个文件                    # 只加要提交的
# 或
git add .                           # 加全部（注意不要把 .env 加进去）

git commit -m "说明这次改了什么"
```

如果 `git add .` 把 `.env` 加进去了：

```bash
git restore --staged .env
```

### SourceTree

1. 确认当前分支对不对（修 bug 必须是 `release/test`，新需求必须是 `feature/next`）。
2. 中间工作区：勾选要提交的文件（不要勾 `.env`）。
3. 下面写提交说明。
4. 点 **Commit**（提交）。  
   这时只是本地提交。要传到 Gitee 再点 **Push**。

---

## 5. 传到 Gitee（push）

### 终端

```bash
# 当前分支已经设置过上游时（我们推过一次之后）
git push

# 这条分支第一次往 Gitee 推
git push -u origin feature/next
git push -u origin release/test
```

只推标签（一般用不到第二次）：

```bash
git push origin v1.5.1
```

### SourceTree

1. 顶部 **Push**。
2. 勾选你要推的分支（通常只勾**当前**那条：`feature/next` 或 `release/test`）。
3. **不要**误勾 `master`，除非你明确要把主线更新到 Gitee。
4. 确定推送。

推成功后，Gitee 网页该仓库的「分支」里能看到对应分支。

---

## 6. 按场景照做

### 场景 A：测试期间，我写新需求

1. 切到 `feature/next`。
2. 改代码。
3. 提交。
4. `git push` / SourceTree **Push**。

测试包不会变，因为测试冻结在 `release/test`。

### 场景 B：测试提了 bug，我要修

1. 如果 `feature/next` 上有改到一半、还没提交的：先提交，或 SourceTree **工作区文件 → 储藏 / Stash**。
2. 切到 `release/test`。
3. 再 **Pull** 一次，避免别人也修过。
4. 改 bug → 提交 → **Push** `release/test`。
5. 用这次提交的哈希，把修复同步到新需求分支（见场景 C）。
6. 再切回 `feature/next` 继续写新需求。

终端看哈希：

```bash
git checkout release/test
git log --oneline -5
```

SourceTree：在 `release/test` 上点最近那次提交，复制 **Commit** 那串字符（前 7 位够用）。

### 场景 C：bug 已在 test 上修好，接到 feature（避免新需求还带着这个 bug）

人要站在 `feature/next` 上操作。

**终端：**

```bash
git checkout feature/next
git pull
git cherry-pick abc1234
# abc1234 换成 release/test 上那次修 bug 的提交哈希
git push
```

若 cherry-pick 出现冲突：见第 7 节。

**SourceTree：**

1. 检出 `feature/next`，先 **Pull**。
2. 左侧切到 `release/test` 的提交列表（点那条分支看历史，但先**不要**检出它，以免搞混；也可以先记下哈希再回到 `feature/next`）。
3. 找到那次修 bug 的提交 → 右键 → **Cherry Pick**。
4. 确认目标是当前的 `feature/next`。
5. 完成后再 **Push** `feature/next`。

也可以一次把 test 上所有还没进来的修复都并进 feature：

**终端：**

```bash
git checkout feature/next
git merge release/test
git push
```

**SourceTree：** 当前在 `feature/next` → 右键 `release/test` → **Merge release/test into feature/next** → 再 Push。

方向一定是：**feature 去合并 test**。不要把 `feature/next` 合并进 `release/test`（否则测试包会混进未测新功能）。

### 场景 D：这期测完了，要收到主线

只在这时动 `master`。

**终端：**

```bash
git checkout master
git pull
git merge release/test
git push

# 新需求也要进主线时（下一期再测也行，不必同一天）
git merge feature/next
git push
```

**SourceTree：**

1. 双击检出 `master`，**Pull**。
2. 右键 `release/test` → **Merge into current branch**。
3. **Push** `master`。
4. 若要合新需求：右键 `feature/next` → **Merge into current branch** → 再 **Push**。

---

## 7. 冲突了怎么办（同一文件两边都改）

同一个文件不一定冲突；只有改到**同一段**才会停下来。

### 终端

`merge` 或 `cherry-pick` 停住后：

```bash
git status                 # 看哪些文件是 both modified
```

用编辑器打开文件，删掉这三行标记，留下正确代码：

```
<<<<<<< HEAD
（当前分支的内容，例如 feature 的新需求）
=======
（进来的那方，例如 test 的 bug 修复）
>>>>>>> 分支名
```

原则：测试修过的正确行为要留下，新需求的结构也要留下，通常是拼在一起，不是整段只留一边。

```bash
git add 冲突文件
# 如果是 merge：
git commit
# 如果是 cherry-pick：
git cherry-pick --continue

git push
```

想放弃这次合并：

```bash
git merge --abort
# 或
git cherry-pick --abort
```

### SourceTree

1. 冲突文件会出现在工作区，标成冲突。
2. 右键文件 → **Resolve Conflicts** → 用外部对比工具，或直接打开文件按上面标记改。
3. 改完右键 → **Mark Resolved**（标为已解决）。
4. 再 **Commit** 完成合并，然后 **Push**。

---

## 8. 改到一半必须切分支（stash）

例如：正在 `feature/next` 写到一半，测试突然要你修 bug。

**终端：**

```bash
git stash -u
git checkout release/test
# 修 bug、提交、push
git checkout feature/next
git stash pop
```

**SourceTree：**

1. 顶部或工作区：**Stash** / **储藏**。
2. 检出 `release/test`，修完并 Push。
3. 再检出 `feature/next`。
4. 左侧 **STASHES** 里最新一条，右键 **Apply**（应用）或 **Pop**。

---

## 9. 不要做的事

- 测试还在进行时，不要把 `feature/next` 合并进 `release/test`。
- 不要在 `master` 上随手改这期 bug 或新需求（会和两条工作线对不上）。
- 不要提交 `.env`。
- Push 前看一眼当前分支名。
- 同一个 bug **只在 `release/test` 改一次**；feature / 以后的 master 用 cherry-pick 或 merge 接过去，不要三个分支手改三遍。

---

## 10. 终端速查

```bash
git branch -vv              # 我在哪、跟不跟远程
git status                  # 有没有没提交的
git log --oneline -10       # 最近提交
git log --oneline --graph --all   # 看分叉

git checkout feature/next
git checkout release/test

git pull
git add .
git restore --staged .env   # 误加了 .env 时
git commit -m "说明"
git push

git cherry-pick 提交哈希
git merge release/test      # 必须先 checkout 到 feature/next
```

---

## 11. SourceTree 速查

| 你想做的 | 点哪里 |
|----------|--------|
| 我在哪条分支 | 左侧 BRANCHES 高亮项 |
| 换分支 | 双击分支 / 右键 Checkout |
| 拉 Gitee | 先检出对应分支 → Pull；没有新分支就先 Fetch |
| 提交到本地 | 勾选文件（排除 .env）→ 写说明 → Commit |
| 传到 Gitee | Push，只勾当前要推的分支 |
| 修 bug 接到新需求 | 站在 feature/next → 对 test 上那次提交 Cherry Pick |
| 测试修复整批进新需求 | 站在 feature/next → 右键 release/test → Merge |
| 测完进主线 | 站在 master → Merge release/test，必要时再 Merge feature/next |
| 改到一半要切走 | Stash → 切分支 → 回来再 Apply Stash |

---

## 12. 和这次仓库的对应关系

- 正式测试包对应提交已打标签 `v1.5.1`，分支 `release/test` 从此冻结。
- 你日常开发请停在 `feature/next`。
- 远程已有：`origin/master`、`origin/release/test`、`origin/feature/next`、标签 `v1.5.1`。
