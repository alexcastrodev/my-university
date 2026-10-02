---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Executando e Relatando um Experimento Real"
summary: Este lab aplica a disciplina de baselines e robustez de `graduate-studies/research-statistics` diretamente aos modelos que este arco construiu. O melhor modelo selecionado no Lab 7 é rodado contra um baseline real e justo (uma configuração padrão sem ajuste, não um espantalho), avaliado com o conjunto completo de métricas de Métricas de Avaliação: Precisão, Recall e ROC, e não só com acurácia, ao longo de várias seeds aleatórias para relatar a variabilidade com honestidade, e documentado em um relatório curto e real que responde diretamente à hipótese original do Lab 5, sustentada ou refutada, com a evidência real, e não apenas um número final.
---
## Objetivos de Aprendizagem

- Rodar o modelo final selecionado no Lab 7 contra um baseline genuinamente justo, aplicando a disciplina de baselines justos de `graduate-studies/research-statistics`.
- Avaliar o resultado usando precisão, recall e curvas ROC em vez de só acurácia, seguindo o relato de Métricas de Avaliação: Precisão, Recall e ROC sobre o que a acurácia esconde.
- Rodar a avaliação com várias seeds aleatórias e relatar a variabilidade com honestidade, e não um único número dependente da seed.
- Escrever um relatório curto respondendo diretamente à hipótese original do Lab 5, declarando se ela foi sustentada ou refutada pela evidência real.

## Contexto e Motivação

Cada lab anterior deste arco (formular uma hipótese, dividir os dados com honestidade, selecionar a complexidade do modelo) vinha construindo em direção a este momento: o único experimento real que o ciclo de pesquisa desta disciplina inteira existe para produzir. Este lab aplica diretamente a disciplina de `baselines-and-persuasive-data`, de `graduate-studies/research-statistics`, escolhendo um baseline genuinamente justo, não um espantalho, e relata o resultado do jeito que essa disciplina exige, com variabilidade honesta e uma resposta direta à hipótese que motivou o projeto inteiro.

## Teoria Central

Nada sobre *por que* um baseline precisa ser justo, ou *por que* a acurácia sozinha pode enganar em um dataset desbalanceado, é derivado de novo aqui; os dois argumentos já existem em `baselines-and-persuasive-data` e `evaluation-metrics-precision-recall-and-roc`. Este lab aplica os dois diretamente ao modelo selecionado no Lab 7, rodado pela primeira e única vez contra o conjunto de teste trancado desde o Lab 6.

## Exemplos Resolvidos

### Passo 1: escolhendo um baseline justo, não um espantalho

```python
def majority_class_baseline(y_train):
    # Um baseline real e genuinamente padrão: prever sempre a classe
    # mais comum; de propósito NÃO é uma versão não treinada ou
    # inicializada aleatoriamente do mesmo modelo, o que seria uma
    # comparação com espantalho contra a qual baselines-and-persuasive-data alerta
    majority = np.bincount(y_train).argmax()
    return lambda X: np.full(len(X), majority)

def logistic_baseline(X_train, y_train):
    # Um SEGUNDO baseline, mais forte: uma regressão logística SEM
    # regularização com o conjunto de features original do Lab 6, sem
    # nenhuma varredura de complexidade; um ponto de comparação real e
    # padrão, não o mais fraco possível
    w = logistic_fit(add_bias_column(X_train), y_train)
    return lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5
```

### Passo 2: avaliando com o conjunto completo de métricas, não só com acurácia

```python
def evaluate_full(model_predict_fn, X_test, y_test):
    predictions = model_predict_fn(X_test)
    tp = np.sum((predictions == 1) & (y_test == 1))
    fp = np.sum((predictions == 1) & (y_test == 0))
    fn = np.sum((predictions == 0) & (y_test == 1))
    tn = np.sum((predictions == 0) & (y_test == 0))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    accuracy = (tp + tn) / len(y_test)
    return {"accuracy": accuracy, "precision": precision, "recall": recall}
```

Em um dataset em que uma das classes é rara, exatamente o caso que `evaluation-metrics-precision-recall-and-roc` usa como motivação, `majority_class_baseline` pode atingir uma acurácia enganosamente alta apenas prevendo sempre a classe comum, enquanto seu recall na classe rara é exatamente zero; relatar só a acurácia aqui faria um baseline genuinamente inútil parecer competitivo.

### Passo 3: rodando com várias seeds e relatando a variabilidade com honestidade

```python
def test_final_experiment_across_seeds():
    results = []
    for seed in range(10):
        X_train, y_train, X_val, y_val, X_test, y_test = load_split(seed=seed)
        selected_degree = select_final_model_from_lab7(X_train, y_train, X_val, y_val)
        final_model = fit_final_model(X_train, y_train, degree=selected_degree)

        metrics = evaluate_full(final_model.predict, X_test, y_test)
        results.append(metrics)

    accuracies = [r["accuracy"] for r in results]
    print(f"Acurácia do modelo final: {np.mean(accuracies):.3f} +/- {np.std(accuracies):.3f} em 10 seeds")
    # ESTE é o número honesto; o resultado de uma única seed, relatado
    # sozinho, esconderia exatamente essa variabilidade
```

### Passo 4: o relatório escrito, respondendo diretamente à hipótese do Lab 5

```text
RELATÓRIO DO EXPERIMENTO

Hipótese (de forming-a-falsifiable-hypothesis-on-a-real-dataset):
  "A regularização melhora o R² retido em pelo menos 0,03 em comparação
  com a versão não regularizada, no split retido de [dataset]."

Baseline: modelo logístico/linear sem regularização com o conjunto de
  features original do Lab 6 (um baseline real e padrão; veja o Passo 1).

Resultado: o modelo com regularização Ridge atingiu acurácia retida
  média de 0,847 +/- 0,012 em 10 seeds, contra 0,809 +/- 0,019 do
  baseline sem regularização, uma melhora de 0,038.

Veredito: HIPÓTESE SUSTENTADA; a melhora observada (0,038) supera o
  limiar pré-registrado (0,03), e a variabilidade entre seeds
  (+/- 0,012 e +/- 0,019) é pequena em relação a essa diferença.
```

## Equívocos Comuns e Armadilhas

- **"Uma única execução bem escolhida basta para relatar um resultado final."** A comparação do Passo 3 ao longo de 10 seeds é justamente o que revelaria um resultado que só pareceu forte por causa de uma inicialização ou split aleatório favorável; uma única execução não consegue distinguir um efeito real e confiável de uma coincidência da aleatoriedade particular daquela execução.
- **"Um modelo não treinado ou inicializado aleatoriamente é um bom baseline, já que qualquer coisa treinada deveria vencê-lo."** Essa é exatamente a comparação fraca e injustamente fácil contra a qual `baselines-and-persuasive-data` alerta; os dois baselines do Passo 1, previsão da classe majoritária e um modelo logístico de fato treinado, são pontos de comparação genuinamente padrão e competitivos que um leitor experiente esperaria, e não espantalhos escolhidos para fazer o modelo final parecer melhor do que é.
- **"Relatar a métrica que mostra o modelo sob a melhor luz é aceitável, já que o modelo de fato melhorou nela."** Essa é exatamente a falha que `forming-a-falsifiable-hypothesis-on-a-real-dataset` foi escrito especificamente para evitar; o relatório do Passo 4 responde à métrica e ao limiar pré-registrados no Lab 5, e não a uma métrica selecionada depois do fato porque calhou de parecer favorável.

## Resumo

Este lab executa o único experimento real em direção ao qual o ciclo de pesquisa desta disciplina vinha construindo: o modelo selecionado no Lab 7 avaliado contra um baseline genuinamente justo (não um espantalho), usando o conjunto completo de métricas de precisão/recall/acurácia em vez de só acurácia, ao longo de várias seeds aleatórias para relatar a variabilidade com honestidade em vez de um único número dependente da seed. O entregável real do lab é um relatório escrito que responde diretamente à hipótese pré-registrada no Lab 5, declarando com clareza se a evidência real, medida com honestidade, a sustenta ou a refuta, exatamente a disciplina que `graduate-studies/research-statistics` estabelece e que este lab aplica pela primeira vez a um projeto real e prático de ML.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): a fonte das métricas de avaliação de precisão/recall/ROC que este lab aplica em vez de usar só a acurácia.
- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): a fonte da disciplina de baselines justos e de relato de variabilidade sobre a qual o experimento final e o relatório deste lab são construídos.
