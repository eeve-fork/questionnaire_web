import userDefined from '@/utils/userDefined';
import MaterielFactory from '@/hooks/useQuestionnaire/materielFactory';


export default class LogicProcessor {

  constructor(questionnaireData, option = {}) {

    if (!questionnaireData) {
      throw new Error('[LogicProcessor](constructor): questionnaireData不能为空');
    }

    this.questionnaireData = questionnaireData;

    this.option = option;
  }

  // 校验逻辑规则
  validateLogic(logic) {
    if (!logic) {
      return false;
    }

    // 逻辑缺失: 源字段
    if (!logic.sourceKey) {
      return false;
    }

    // 逻辑缺失: 源规则
    if (!logic.sourceRule) {
      return false;
    }

    // 逻辑缺失: 源字段
    if (!logic.sourceType) {
      return false;
    }

    /**
     * 逻辑缺失: 目标规则
     * 有效值: 显示-normal, 隐藏-hidden, 禁用-disabled, 只读-readonly, 滚动至-toQuestion
     */
    if (!logic.targetRule) {
      return false;
    }

    // 逻辑缺失: 目标列表
    if (!logic.targetKeyList.length) {
      return false;
    }

    // 源题目实例
    const sourceQuestion = this.questionnaireData.questionList.find((item) => item.key === logic.sourceKey);

    // 源题目不存在
    if (!sourceQuestion) {
      return false;
    }

    // 过滤有效的目标题目, 因为可能存在目标题目不存在的情况
    const targetQuestionList = this.questionnaireData.questionList.filter((item) => {
      return logic.targetKeyList.includes(item.key);
    });

    // 源题目实例为空, 不执行规则
    if (!targetQuestionList.length) {
      return false;
    }

    // 订阅事件不存在, 不执行规则
    if (!this.option.subscribe) {
      return false;
    }

    return true;
  }

  // 执行规则
  executeLogic(logic) {
    // 校验逻辑规则
    if (!this.validateLogic(logic)) {
      return;
    }

    // 过滤有效的目标题目, 因为可能存在目标题目不存在的情况
    const targetQuestionList = this.questionnaireData.questionList.filter((item) => {
      return logic.targetKeyList.includes(item.key);
    });

    // 目标题目实例初始状态集合
    const targetQuestionOldStatusMap = new Map();

    // 目标题目实例初始状态
    targetQuestionList.forEach((item) => {
      targetQuestionOldStatusMap.set(item.key, item.props.status);
    });

    // 源题目实例
    const sourceQuestion = this.questionnaireData.questionList.find((item) => item.key === logic.sourceKey);

    // 值变动事件名称
    const eventName = `${logic.sourceKey}_onChange`;

    // 逻辑处理函数
    const handleLogicFn = (newValue) => {

      // 源模型
      const sourceModel = MaterielFactory.createMateriel(logic.sourceType, sourceQuestion);

      // 目标题目状态
      const targetRule = logic.targetRule;

      // 处理目标题目规则
      const handleTargetRule = (isCheckPass) => {

        // 设置目标题目状态
        const setTargetStatus = (targetQuestion, status) => {
          // 如果目标题目是源题目, 则跳过
          if (targetQuestion.key === sourceModel.key) {
            return;
          }

          // 设置目标题目状态
          targetQuestion.props.status = status;
        };

        // 如果校验通过
        if (isCheckPass) {
          // 设置目标题目状态
          if (['normal', 'disabled', 'readonly', 'hidden'].includes(targetRule)) {
            targetQuestionList.forEach((targetQuestion) => {
              // 记录变更前的状态
              const prevStatus = targetQuestion.props.status;
              setTargetStatus(targetQuestion, targetRule);

              // 当目标题目从隐藏变为可见时，重新评估其下游依赖的逻辑
              if (prevStatus === 'hidden' && targetRule !== 'hidden') {
                this.cascadeReevaluateDownstream(targetQuestion);
              }
            });
          }

          // 滚动至指定题目
          if (targetRule === 'toQuestion') {
            targetQuestionList.forEach((targetQuestion) => {
              userDefined.scrollIntoView(targetQuestion.key);
            });
          }
        } else {
          targetQuestionList.forEach((targetQuestion) => {
            // 记录变更前的状态
            const prevStatus = targetQuestion.props.status;
            const revertStatus = targetQuestionOldStatusMap.get(targetQuestion.key);
            setTargetStatus(targetQuestion, revertStatus);

            // 当目标题目状态变为隐藏时，级联隐藏其下游依赖的题目
            if (revertStatus === 'hidden' && prevStatus !== 'hidden') {
              this.cascadeHideDownstream(targetQuestion);
            }
          });
        }
      };

      if (logic.sourceRule === '已答') {
        const verifyInRealTimeData = sourceModel.verifyInRealTime();

        if (verifyInRealTimeData?.status === 'success') {
          handleTargetRule(true);
        } else {
          handleTargetRule(false);
        }
      }

      if (logic.sourceRule === '未答') {
        const verifyInRealTimeData = sourceModel.verifyInRealTime();

        if (verifyInRealTimeData?.status === 'unverified') {
          handleTargetRule(true);
        } else {
          handleTargetRule(false);
        }
      }

      if (logic.sourceRule === '选中') {
        // 源值
        const sourceValue = logic.sourceValue || [];

        // 是否匹配
        const isMatch = sourceValue.some((item) => newValue.includes(item));

        if (isMatch) {
          handleTargetRule(true);
        } else {
          handleTargetRule(false);
        }
      }

      if (logic.sourceRule === '等于') {
        // 源值
        const sourceValue = logic.sourceValue || '';

        // 是否匹配, 这里特意写成==，因为有可能是数字和字符串比较
        // eslint-disable-next-line eqeqeq
        const isMatch = newValue == sourceValue;

        if (isMatch) {
          handleTargetRule(true);
        } else {
          handleTargetRule(false);
        }
      }
    };

    // 初始化执行一遍
    handleLogicFn(sourceQuestion.props.defaultValue);

    // 后续变动再继续执行
    this.option.subscribe.on(eventName, (newValue) => {
      handleLogicFn(newValue);
    });
  }

  /**
   * 级联隐藏下游依赖的题目
   * 当某个题目被隐藏时，找到以该题目为源题目的所有逻辑，将其目标题目也隐藏
   */
  cascadeHideDownstream(question) {
    const logicList = this.questionnaireData.logicList || [];

    // 找到以该题目为源题目的所有逻辑
    const downstreamLogics = logicList.filter((logic) => logic.sourceKey === question.key);

    downstreamLogics.forEach((logic) => {
      const targetQuestionList = this.questionnaireData.questionList.filter((item) => {
        return logic.targetKeyList.includes(item.key);
      });

      targetQuestionList.forEach((targetQuestion) => {
        // 避免循环引用
        if (targetQuestion.key === question.key) {
          return;
        }

        // 如果已经是隐藏状态，不需要重复处理
        if (targetQuestion.props.status === 'hidden') {
          return;
        }

        targetQuestion.props.status = 'hidden';

        // 继续级联隐藏
        this.cascadeHideDownstream(targetQuestion);
      });
    });
  }

  /**
   * 级联重新评估下游依赖的逻辑
   * 当某个题目从隐藏变为可见时，以其当前值重新触发下游逻辑评估
   */
  cascadeReevaluateDownstream(question) {
    if (!this.option.subscribe) {
      return;
    }

    const logicList = this.questionnaireData.logicList || [];

    // 检查是否有以该题目为源题目的下游逻辑
    const hasDownstream = logicList.some((logic) => logic.sourceKey === question.key);

    if (!hasDownstream) {
      return;
    }

    // 以该题目的当前值重新触发onChange事件，让所有下游逻辑重新评估
    const eventName = `${question.key}_onChange`;
    this.option.subscribe.emit(eventName, question.props.defaultValue);
  }

  // 执行
  run() {
    const logicList = this.questionnaireData.logicList || [];

    logicList.forEach(logic => {
      this.executeLogic(logic);
    });
  }
}