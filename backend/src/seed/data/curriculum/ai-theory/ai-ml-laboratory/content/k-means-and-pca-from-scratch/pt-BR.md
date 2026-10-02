---
version: 1.0
updatedAt: 2026-09-12
title: "Lab: k-Means e PCA, do Zero"
summary: Diferente dos Labs 1 a 3, estes dois algoritmos não têm rótulos contra os quais ajustar, nem uma função de loss medindo a distância até uma resposta certa conhecida, e essa é a lição concreta e prática que este lab foi construído para entregar. O loop de atribuir e depois atualizar de Agrupamento k-Means é implementado do zero e executado até convergir, e a decomposição em autovalores da matriz de covariância de um dataset real feita pela Análise de Componentes Principais é verificada não contra um rótulo, mas contra uma propriedade geométrica diretamente checável: a distância total dentro dos clusters do k-means diminuindo estritamente a cada iteração, e os principais componentes do PCA capturando a fração calculada e declarada da variância total.
---
## Objetivos de Aprendizagem

- Implementar do zero o loop de atribuir e depois atualizar do agrupamento k-means e verificar que a distância total dentro dos clusters diminui de forma monotônica até convergir.
- Implementar o PCA decompondo em autovalores a matriz de covariância de um dataset real e verificar que os principais componentes capturam a fração declarada da variância total.
- Explicar por que nenhum dos dois algoritmos tem uma "resposta certa" rotulada contra a qual checar previsões, e como fica a verificação de correção nesse cenário.
- Aplicar os dois algoritmos ao mesmo dataset real sem rótulos e interpretar o que cada um realmente revela sobre a estrutura dele.

## Contexto e Motivação

Todos os labs anteriores deste arco, do Lab 1 ao 3, ajustaram um modelo contra rótulos conhecidos (um valor-alvo, uma classe) e verificaram a correção comparando previsões com esses rótulos ou com um gradiente calculado de forma independente. **Agrupamento k-Means** e **Análise de Componentes Principais** são genuinamente diferentes: os dois operam sobre dados sem rótulo nenhum, o que significa que o objetivo inteiro deste lab é encarar uma pergunta real e prática que os labs anteriores nunca precisaram fazer: o que "correto" sequer significa quando não há uma resposta certa conhecida para comparar?

## Teoria Central

Nada sobre *por que* os passos alternados de atribuir e atualizar do k-means convergem, ou *por que* os principais autovetores do PCA capturam as direções de maior variância, é derivado de novo aqui; os dois argumentos já existem em `k-means-clustering` e `principal-component-analysis`. Este lab implementa os dois e identifica as propriedades reais e checáveis que a teoria de cada algoritmo garante, no lugar da verificação baseada em rótulos.

## Exemplos Resolvidos

### Especificação da API

```text
kmeans_fit(X, k: int, iters: int) -> (centroids: ndarray, assignments: ndarray)
pca_fit(X, n_components: int) -> (components: ndarray, explained_variance_ratio: ndarray)
```

### Passo 1: k-means, atribuir e depois atualizar, repetidamente

```python
def kmeans_fit(X, k, iters=100, seed=0):
    rng = np.random.default_rng(seed)
    centroids = X[rng.choice(len(X), k, replace=False)]  # inicializa com pontos reais dos dados
    total_distance_history = []

    for _ in range(iters):
        distances = np.linalg.norm(X[:, None] - centroids[None, :], axis=2)
        assignments = np.argmin(distances, axis=1)  # passo de ATRIBUIÇÃO

        total_distance_history.append(
            sum(np.linalg.norm(X[i] - centroids[assignments[i]]) for i in range(len(X)))
        )

        for j in range(k):  # passo de ATUALIZAÇÃO
            points_in_cluster = X[assignments == j]
            if len(points_in_cluster) > 0:
                centroids[j] = points_in_cluster.mean(axis=0)

    return centroids, assignments, total_distance_history
```

### Passo 2: a checagem real, a distância total precisa diminuir monotonicamente

```python
def test_kmeans_total_distance_decreases_monotonically():
    X = load_real_unlabeled_dataset()  # ex.: um dataset real e pequeno de agrupamento
    _, _, distance_history = kmeans_fit(X, k=3, iters=50, seed=0)

    for i in range(len(distance_history) - 1):
        assert distance_history[i + 1] <= distance_history[i] + 1e-9, \
            f"a distância total dentro dos clusters aumentou na iteração {i}, o que a garantia de convergência do k-means proíbe"
```

Esta é a checagem de correção que a teoria de `k-means-clustering` realmente garante: não que algum agrupamento específico esteja "correto" (não há verdade rotulada para comparar), mas que a distância total dentro dos clusters do loop de atribuir e atualizar nunca pode aumentar de uma iteração para a seguinte. Um bug que viola essa propriedade específica e checável é um bug real, independentemente de os clusters resultantes parecerem razoáveis ou não.

### Passo 3: PCA via decomposição em autovalores da matriz de covariância

```python
def pca_fit(X, n_components):
    X_centered = X - X.mean(axis=0)  # o PCA exige dados com média zero
    covariance = (X_centered.T @ X_centered) / (len(X) - 1)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)  # eigh: a covariância é simétrica

    order = np.argsort(eigenvalues)[::-1]  # maior autovalor primeiro
    eigenvalues, eigenvectors = eigenvalues[order], eigenvectors[:, order]

    components = eigenvectors[:, :n_components]
    explained_variance_ratio = eigenvalues[:n_components] / eigenvalues.sum()
    return components, explained_variance_ratio
```

### Passo 4: a checagem real, a variância explicada é um número checável, não apenas afirmado

```python
def test_pca_explained_variance_matches_projection():
    X = load_real_unlabeled_dataset()
    components, explained_ratio = pca_fit(X, n_components=2)

    X_centered = X - X.mean(axis=0)
    projected = X_centered @ components
    reconstructed = projected @ components.T

    total_variance = np.var(X_centered, axis=0).sum()
    residual_variance = np.var(X_centered - reconstructed, axis=0).sum()
    variance_captured_directly = 1 - (residual_variance / total_variance)

    assert np.isclose(variance_captured_directly, explained_ratio.sum(), atol=1e-6), \
        "a variância capturada ao projetar e reconstruir de fato os dados deve bater com a afirmação baseada nos autovalores"
```

`explained_variance_ratio` é uma afirmação real e falseável: projetar os dados em `n_components` e reconstruí-los deve recuperar exatamente essa fração da variância original, e não um número aproximado ou apenas afirmado. O Passo 4 checa essa afirmação diretamente contra a reconstrução real, em vez de confiar só no cálculo dos autovalores.

## Equívocos Comuns e Armadilhas

- **"Sem rótulos, não há um jeito real de verificar se k-means ou PCA estão implementados corretamente."** Os dois algoritmos têm garantias matemáticas reais e checáveis, independentes de qualquer rótulo: a distância total dentro dos clusters do k-means precisa diminuir monotonicamente, e a variância explicada declarada pelo PCA precisa bater com o que uma projeção e reconstrução reais recuperam; os Passos 2 e 4 checam exatamente essas propriedades.
- **"Um agrupamento 'bonito' ou um número alto de variância explicada já é evidência de uma implementação correta."** Nenhum dos dois é: um k-means com bug poderia produzir clusters visualmente plausíveis que, olhando de perto, ainda violam a garantia de diminuição monotônica, e um PCA com bug poderia relatar um número de variância explicada que não bate com o que reconstruir os dados a partir daqueles componentes recupera. As checagens dos Passos 2 e 4 testam diretamente a propriedade matemática subjacente, não só a plausibilidade da saída final.
- **"O PCA exige que os dados de entrada já tenham média zero antes de esta função ser chamada."** A implementação do Passo 3 centraliza os dados explicitamente por conta própria (`X - X.mean(axis=0)`) em vez de presumir que quem chamou já fez isso; pular esse passo, ou centralizar de forma incorreta, produz componentes que descrevem a variância em torno da origem errada, um bug sutil que a checagem de variância explicada do Passo 4 provavelmente pegaria como uma discrepância.

## Resumo

k-means e PCA operam sobre dados sem rótulo, o que faz a lição central deste lab ser diferente da de todos os labs anteriores deste arco: a verificação de correção não pode se apoiar em comparar previsões com respostas certas conhecidas, mas cada algoritmo ainda tem uma garantia matemática real e checável (a distância total dentro dos clusters do k-means diminuindo monotonicamente a cada iteração, e a variância explicada declarada pelo PCA batendo com o que uma projeção e reconstrução reais recuperam), e este lab implementa os dois algoritmos e testa exatamente essas garantias de forma direta.

## Documentation Links

- [James, Witten, Hastie & Tibshirani: An Introduction to Statistical Learning](https://www.statlearning.com/): cobre tanto a garantia de convergência do k-means quanto a decomposição em autovalores do PCA que este lab implementa e verifica.
- [Stanford CS229: Lecture Notes, Part I: Linear Regression](https://cs229.stanford.edu/main_notes.pdf): uma fonte real complementar para o material de aprendizado não supervisionado de onde vêm os dois algoritmos deste lab.
