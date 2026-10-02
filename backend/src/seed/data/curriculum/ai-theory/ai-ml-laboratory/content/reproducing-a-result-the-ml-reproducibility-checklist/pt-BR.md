---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: Reproduzindo um Resultado, o Checklist de Reprodutibilidade em ML"
summary: O relatório real e revisado por pares do NeurIPS Reproducibility Program sobre reprodutibilidade em machine learning documenta, com dados reais coletados de artigos de fato submetidos, com que frequência resultados publicados de ML falham ao ser reproduzidos e o que costuma faltar. Este lab aplica o checklist desse relatório (hiperparâmetros exatos, passos exatos de pré-processamento, seeds aleatórias exatas, versões de hardware e software) diretamente ao experimento do Lab 8, primeiro escondendo de propósito os itens do checklist (imitando um artigo tipicamente mal documentado) para mostrar que uma nova tentativa de implementação não reproduz o número relatado, e depois preenchendo cada item e confirmando que agora ela reproduz.
---
## Objetivos de Aprendizagem

- Aplicar o checklist do NeurIPS Reproducibility Program ao experimento do Lab 8: hiperparâmetros exatos, passos de pré-processamento, seeds aleatórias e versões de software/hardware.
- Simular um artigo tipicamente mal documentado retendo de propósito itens do checklist, e observar uma nova tentativa de reprodução falhar como consequência.
- Preencher cada item do checklist e confirmar que a mesma tentativa de reprodução agora funciona, batendo com o resultado originalmente relatado dentro da variabilidade esperada.
- Explicar, usando dados reais do relatório do NeurIPS, quão comum e quão grave é de fato a falta de informações de reprodutibilidade na pesquisa publicada em machine learning.

## Contexto e Motivação

`running-and-reporting-a-real-experiment` produziu um resultado real e um relatório escrito. Este lab faz uma pergunta mais difícil e mais desconfortável sobre esse resultado: outra pessoa, tendo apenas o que foi escrito, conseguiria de fato reproduzi-lo? O relatório real e revisado por pares do NeurIPS Reproducibility Program, publicado no JMLR, documenta exatamente esse problema em escala, com dados reais coletados de artigos de machine learning de fato submetidos, não como uma preocupação hipotética, mas como uma falha comum e medida.

## Teoria Central

Nada sobre *por que* a reprodutibilidade importa, ou sobre o argumento geral para descrever experimentos com precisão, é derivado de novo aqui; esse argumento já existe em `coding-for-experimentation-and-describing-experiments`, de `graduate-studies/research-statistics`. Este lab aplica o checklist específico e real que o programa do NeurIPS desenvolveu, com itens específicos de machine learning que um checklist geral de experimentação não nomeia explicitamente (faixas de busca de hiperparâmetros, seeds aleatórias exatas, versões exatas de software), diretamente ao experimento do Lab 8.

## Exemplos Resolvidos

### O checklist, aplicado ao experimento do Lab 8

```text
Itens do NeurIPS Reproducibility Checklist relevantes para o experimento deste arco:

[ ] Todos os detalhes de treino (hiperparâmetros, taxa de aprendizado, iterações)
[ ] Número de seeds aleatórias usadas, e como a variabilidade foi relatada
[ ] Metodologia exata do split de treino/validação/teste
[ ] Passos exatos de pré-processamento dos dados (incluindo a origem
    das estatísticas de normalização; veja a discussão de vazamento de
    dataset-work-splits-leakage-and-honest-evaluation)
[ ] Versões de software (versão do NumPy, versão do Python)
[ ] Hardware usado, se tempo de execução ou medições de tempo forem relatados
[ ] Um link para o código real, ou a inclusão dele
```

### Passo 1: simulando um artigo tipicamente mal documentado

```text
SEÇÃO DE MÉTODOS "MAL DOCUMENTADA" (incompleta de propósito, seguindo
o padrão de omissões comuns documentado pelo próprio relatório do NeurIPS):

  "Treinamos um modelo linear regularizado no dataset de imóveis e
  atingimos uma acurácia retida de 0,847, superando um baseline em
  0,038."

Faltando: a FORÇA da regularização (lambda), a(s) seed(s) aleatória(s)
exata(s), os passos exatos de pré-processamento e a definição exata do
baseline; todas omissões reais e comuns que o relatório do NeurIPS
documenta em artigos de fato submetidos, e não omissões inventadas
para este lab.
```

### Passo 2: uma nova tentativa de reprodução, tendo SOMENTE a descrição mal documentada

```python
def attempt_reproduction_from_underdocumented_description():
    # Uma implementação nova, escrita por alguém que leu APENAS a seção
    # de métodos acima, sem acesso ao código real dos Labs 7/8
    X, y = load_real_dataset()
    X_train, y_train, X_test, y_test = arbitrary_split(X, y, seed=42)  # seed chutada
    w = ridge_fit(add_bias_column(X_train), y_train, lam=1.0)          # lambda chutado
    accuracy = evaluate_full(lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5, X_test, y_test)["accuracy"]
    return accuracy

def test_reproduction_fails_without_full_checklist():
    reproduced_accuracy = attempt_reproduction_from_underdocumented_description()
    original_accuracy = 0.847  # de running-and-reporting-a-real-experiment
    assert abs(reproduced_accuracy - original_accuracy) > 0.02, \
        "uma tentativa de reprodução que chuta hiperparâmetros e metodologia de split ausentes NÃO deve bater de perto com o original"
```

### Passo 3: a mesma tentativa, agora com TODOS os itens do checklist preenchidos

```python
def attempt_reproduction_with_full_checklist():
    X, y = load_real_dataset()
    # Cada valor abaixo agora vem DIRETAMENTE da configuração registrada
    # dos Labs 6/7/8, e não de um chute
    X_train, y_train, X_test, y_test = correct_split(X, y, seed=EXACT_SEED_FROM_LAB6)
    train_mean, train_std = X_train.mean(axis=0), X_train.std(axis=0)
    X_train_norm = (X_train - train_mean) / train_std
    X_test_norm = (X_test - train_mean) / train_std
    w = ridge_fit(add_bias_column(X_train_norm), y_train, lam=EXACT_LAMBDA_FROM_LAB7)
    accuracy = evaluate_full(lambda X: sigmoid(add_bias_column(X) @ w) >= 0.5, X_test_norm, y_test)["accuracy"]
    return accuracy

def test_reproduction_succeeds_with_full_checklist():
    reproduced_accuracy = attempt_reproduction_with_full_checklist()
    original_accuracy = 0.847
    assert abs(reproduced_accuracy - original_accuracy) < 0.005, \
        "com cada item do checklist especificado exatamente, a reprodução deve bater de perto com o original"
```

### Passo 4: o que o relatório real do NeurIPS de fato encontrou

```text
O relatório do NeurIPS Reproducibility Program documenta, a partir de
artigos de fato submetidos, que informações faltando exatamente desse
tipo (valores de hiperparâmetros, seeds aleatórias, detalhes de
pré-processamento) eram uma causa comum e medida de tentativas de
reprodução fracassadas, o que motivou a inclusão do checklist como parte
formal do processo de submissão em uma grande conferência de machine
learning, e não como uma sugestão de boa prática opcional.
```

## Equívocos Comuns e Armadilhas

- **"Relatar um número final de acurácia é documentação suficiente, já que é o número em si que importa."** A tentativa de reprodução fracassada do Passo 2 demonstra diretamente por que isso é falso: o número sozinho, sem a configuração exata que o produziu, não pode ser verificado de forma independente nem servir de base para mais ninguém, e esse é o custo real e prático que a falta de documentação impõe.
- **"Problemas de reprodutibilidade em machine learning são incidentes raros e isolados, não um padrão sistêmico."** Os dados reais coletados pelo NeurIPS Reproducibility Program a partir de artigos de fato submetidos documentam isso como um padrão comum e medido, significativo o bastante para que uma grande conferência incluísse um checklist formal em seu processo de submissão especificamente para tratá-lo.
- **"Depois que os itens do checklist forem preenchidos, a reprodução deve bater exatamente com o resultado original, não só de perto."** O teste do Passo 3 checa uma concordância próxima, não exata; aleatoriedade real (hardware diferente, pequenas diferenças de ponto flutuante, uma implementação diferente do gerador de números aleatórios entre ambientes) ainda pode produzir pequenas variações mesmo com cada item do checklist especificado corretamente, e essa é uma preocupação diferente e mais estreita que a grande diferença, causada pela falta do checklist, que o Passo 2 demonstra.

## Resumo

Este lab aplica o checklist real do NeurIPS Reproducibility Program, publicado no JMLR, ao resultado de `running-and-reporting-a-real-experiment`: simula um artigo tipicamente mal documentado retendo detalhes específicos de configuração, mostra que uma nova tentativa de reprodução falha como consequência direta e medida disso, e depois preenche cada item do checklist e confirma que a mesma tentativa agora funciona. A diferença entre essas duas tentativas não é hipotética; ela reflete um padrão real e documentado que o relatório do NeurIPS encontrou em artigos de machine learning de fato submetidos, e é por isso que uma grande conferência incorporou esse checklist ao seu processo formal de submissão, em vez de deixar a reprodutibilidade para convenções informais.

## Documentation Links

- [Pineau et al.: Improving Reproducibility in Machine Learning Research (JMLR, 2021)](https://www.jmlr.org/papers/v22/20-303.html): a fonte real e revisada por pares do checklist de reprodutibilidade e do padrão documentado de omissões comuns em que o artigo mal documentado simulado deste lab se baseia.
- [ACM Digital Library: Justin Zobel, Writing for Computer Science (3rd Edition, Springer, 2014)](https://dl.acm.org/doi/10.5555/2742708): a fonte da disciplina geral de descrição de experimentos que o checklist específico de machine learning deste lab estende.
