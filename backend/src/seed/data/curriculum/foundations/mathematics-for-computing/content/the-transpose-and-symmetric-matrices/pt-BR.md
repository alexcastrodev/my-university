---
version: 1.0
updatedAt: 2026-09-06
title: A Transposta e Matrizes Simétricas
summary: Aᵀ reflete uma matriz pela diagonal; (AB)ᵀ = BᵀAᵀ inverte a ordem; uma matriz simétrica satisfaz A = Aᵀ, e AᵀA é sempre simétrica para qualquer A, a razão por trás de matrizes de Gram e covariância.
---
## Objetivos de Aprendizagem

- Definir a transposta Aᵀ de uma matriz, e calculá-la diretamente para um exemplo concreto m×n.
- Enunciar e verificar as propriedades algébricas centrais da transposta: (Aᵀ)ᵀ = A, (A+B)ᵀ = Aᵀ+Bᵀ, (cA)ᵀ = cAᵀ, e, a que inverte a ordem, (AB)ᵀ = BᵀAᵀ.
- Definir uma matriz simétrica (A = Aᵀ), reconhecer por que simetria exige uma matriz quadrada, e provar que AᵀA é simétrica para qualquer matriz A.
- Identificar lugares comuns onde matrizes simétricas surgem na prática, como matrizes de Gram (AᵀA) e matrizes de covariância.
- Enunciar, sem prova, que matrizes simétricas têm autovalores incomumente bem comportados, um fato que um conceito posterior nesta disciplina desenvolve completamente.

## Contexto e Motivação

A transposta é, à primeira vista, uma das operações menos dramáticas da álgebra linear, vire uma matriz pela sua diagonal, e troque o que era uma linha pelo que era uma coluna. Mas essa operação simples e puramente mecânica aparece constantemente, muitas vezes silenciosamente, ao longo do resto deste curso e da álgebra linear aplicada em geral. O conceito de produto escalar já a usou implicitamente: escrever um vetor u como uma coluna e calcular uᵀv é exatamente o padrão linha-vezes-coluna que produz o familiar produto escalar em número, e essa notação, uma transposta transformando uma coluna em uma linha para que possa ser multiplicada contra outra coluna, reaparece em todo lugar onde um produto escalar precisa ser expresso em forma matricial.

A transposta também isola uma família especialmente importante de matrizes: aquelas iguais à sua própria transposta, chamadas de matrizes simétricas. Essas não são uma curiosidade rara, surgem naturalmente e repetidamente no trabalho aplicado. Sempre que um conjunto de dados é representado como uma matriz A (linhas como observações, colunas como características, a formulação em que a revisão de álgebra linear do CS229 se apoia o tempo todo), o produto AᵀA é uma matriz simétrica que aparece como a matriz de equações normais em regressão de mínimos quadrados (um conceito posterior nesta disciplina) e, em uma forma intimamente relacionada, como a matriz de covariância por trás de PCA e inúmeras outras técnicas estatísticas. Matrizes simétricas valem a pena entender como sua própria categoria agora precisamente porque um conceito posterior nesta disciplina vai mostrar que elas têm autovalores incomumente limpos e bem comportados, reais e emparelhados com autovetores ortogonais, garantias que falham para matrizes gerais, mas esse retorno é mais fácil de apreciar uma vez que a definição e a álgebra básica de simetria já estão confortáveis, que é todo o trabalho deste conceito.

## Teoria Central

### Definição da transposta

Para uma matriz A ∈ ℝ^(m×n), a **transposta** Aᵀ ∈ ℝ^(n×m) é obtida transformando a linha i de A na coluna i de Aᵀ (equivalentemente, refletindo toda entrada pela diagonal principal):

    Aᵀ[j,i] = A[i,j]     para todo i, j

Concretamente, se

    A = [ 1  2  3 ]     (2×3)
        [ 4  5  6 ]

então

    Aᵀ = [ 1  4 ]     (3×2)
         [ 2  5 ]
         [ 3  6 ]

Note a mudança de formato: uma matriz m×n transpõe para uma matriz n×m. Apenas quando m = n (uma matriz quadrada) a transposta tem o mesmo formato do original, uma condição necessária (embora não suficiente) para que A possivelmente seja igual a Aᵀ. Esta é exatamente a notação usada para transformar um vetor coluna em um vetor linha: para vetores coluna u, v ∈ ℝⁿ, a expressão uᵀv é uma matriz 1×n vezes uma matriz n×1, produzindo um resultado 1×1, um único número, que acaba sendo exatamente o produto escalar u · v do conceito anterior de produto escalar. Todo produto escalar calculado até agora pode ser reescrito dessa forma, e essa notação é a padrão usada daqui em diante sempre que uma prova precisa manipular um produto escalar algebricamente.

### Propriedades algébricas básicas

Quatro propriedades seguem diretamente da definição de troca de entrada, cada uma verificável comparando entradas em ambos os lados:

    (Aᵀ)ᵀ = A                    (transpor duas vezes retorna o original)
    (A + B)ᵀ = Aᵀ + Bᵀ            (a transposta distribui sobre a soma)
    (cA)ᵀ = c(Aᵀ)                 (escalares passam através sem serem afetados)

A primeira diz que a operação de refletir pela diagonal é sua própria inversa: refletir de volta desfaz o reflexo, entrada por entrada. A segunda e a terceira seguem ambas porque a soma e a multiplicação por escalar são elas mesmas operações entrada por entrada (conceito de operações com matrizes), trocar linhas e colunas não interage de nenhuma forma especial com nenhuma delas, então as operações comutam livremente com a transposição.

### A transposta de um produto inverte a ordem

A propriedade que de fato exige cuidado é como a transposta interage com a multiplicação de matrizes:

    (AB)ᵀ = BᵀAᵀ

Note a inversão, não AᵀBᵀ. Para ver por quê, compare formatos primeiro: se A é m×n e B é n×p, então AB é m×p, então (AB)ᵀ é p×m. No lado direito, Aᵀ é n×m e Bᵀ é p×n; o produto BᵀAᵀ é (p×n)(n×m) = p×m, que corresponde, enquanto AᵀBᵀ seria (n×m)(p×n), que nem sequer é definido a menos que m = p. Os formatos sozinhos já descartam AᵀBᵀ como a resposta geral e apontam para BᵀAᵀ em vez disso. Uma verificação completa entrada por entrada confirma que os valores também concordam: a entrada (j,i) de (AB)ᵀ é igual à entrada (i,j) de AB, que é a linha i de A ponteada com a coluna j de B; a entrada (j,i) de BᵀAᵀ é a linha j de Bᵀ (ou seja, a coluna j de B) ponteada com a coluna i de Aᵀ (ou seja, a linha i de A), o mesmo produto escalar, apenas descrito do outro lado. Esse mesmo padrão exato de inversão de ordem já foi visto com inversas de matriz no conceito anterior, (AB)⁻¹ = B⁻¹A⁻¹, as duas operações, transposta e inversa, ambas "desfazem um produto" invertendo-o, e ambas insistem em inverter a ordem para fazer isso corretamente.

### Matrizes simétricas

Uma matriz quadrada A é **simétrica** se é igual à sua própria transposta:

    A = Aᵀ

Equivalentemente, A[i,j] = A[j,i] para todo i, j, a matriz parece a mesma seja lida normalmente ou refletida pela sua diagonal principal. Uma matriz simétrica deve ser quadrada (apenas matrizes quadradas podem ser iguais à sua própria transposta, já que Aᵀ tem dimensões trocadas a menos que m = n). Matrizes simétricas surgem constantemente, e uma fonte especialmente útil e geral vale a pena provar diretamente:

**Afirmação: AᵀA é simétrica, para qualquer matriz A (não necessariamente quadrada).**

**Prova.** Seja B = AᵀA. Então, usando a regra de inversão de produto recém-estabelecida junto com (Aᵀ)ᵀ = A:

    Bᵀ = (AᵀA)ᵀ = Aᵀ(Aᵀ)ᵀ = AᵀA = B

Como Bᵀ = B, B é simétrica. ∎

Note que isso vale independentemente de a própria A ser quadrada, ou simétrica, ou ter qualquer estrutura especial de forma alguma, AᵀA é simétrica incondicionalmente, para literalmente qualquer matriz A para a qual o produto é definido (o que sempre é o caso para AᵀA, já que A é m×n e Aᵀ é n×m, tornando AᵀA um produto n×n toda vez). Este único fato é a razão pela qual matrizes de Gram (AᵀA, usadas em mínimos quadrados) e matrizes de covariância (construídas a partir de AᵀA depois de centralizar os dados) são sempre simétricas por construção, uma propriedade explorada intensamente mais tarde quando autovalores entram na cena.

### Ponteiro para frente: matrizes simétricas e autovalores

Um conceito posterior nesta disciplina, autovalores de matrizes simétricas, prova duas garantias notáveis que valem apenas para matrizes simétricas e podem falhar para matrizes quadradas gerais: todo autovalor de uma matriz simétrica é um número real (nunca complexo, mesmo que autovalores complexos sejam inteiramente possíveis para matrizes não simétricas), e seus autovetores sempre podem ser escolhidos mutuamente ortogonais. Nada desse maquinário é necessário aqui, o ponto de sinalizá-lo agora é apenas que a definição sendo aprendida neste conceito, A = Aᵀ, não é um caso especial arbitrário para arquivar, mas a condição exata que mais tarde desbloqueia alguns dos resultados mais limpos e amplamente usados na álgebra linear aplicada, incluindo a matemática por trás de PCA.

## Exemplos Resolvidos

### Exemplo 1 — calculando uma transposta e confirmando a propriedade da dupla transposta

**Problema.** Seja A = [ 1 2 3 ; 0 -1 4 ] (2×3). Calcule Aᵀ, depois calcule (Aᵀ)ᵀ e confirme que é igual a A.

**Transposta.** A linha 1 de A, (1, 2, 3), se torna a coluna 1 de Aᵀ; a linha 2 de A, (0, -1, 4), se torna a coluna 2:

    Aᵀ = [ 1   0 ]
         [ 2  -1 ]
         [ 3   4 ]

**Dupla transposta.** Aplicar a mesma regra a Aᵀ (uma matriz 3×2) troca suas linhas e colunas de volta: a linha 1 de Aᵀ, (1,0), se torna a coluna 1; a linha 2, (2,-1), se torna a coluna 2; a linha 3, (3,4), se torna a coluna 3:

    (Aᵀ)ᵀ = [ 1  2  3 ]
            [ 0 -1  4 ]

Isso corresponde a A exatamente, confirmando (Aᵀ)ᵀ = A em um exemplo não quadrado concreto.

### Exemplo 2 — verificando (AB)ᵀ = BᵀAᵀ

**Problema.** Sejam A = [ 1 2 ; 3 4 ] e B = [ 0 1 ; 1 0 ]. Calcule (AB)ᵀ diretamente, depois calcule BᵀAᵀ, e confirme que correspondem.

**Passo 1 — calcule AB.**

    AB = [ 1·0+2·1   1·1+2·0 ]   [ 2  1 ]
         [ 3·0+4·1   3·1+4·0 ] = [ 4  3 ]

**Passo 2 — transponha o produto.**

    (AB)ᵀ = [ 2  4 ]
            [ 1  3 ]

**Passo 3 — calcule Aᵀ e Bᵀ separadamente.**

    Aᵀ = [ 1  3 ]        Bᵀ = [ 0  1 ]
         [ 2  4 ]              [ 1  0 ]

(B acontece de ser igual à sua própria transposta aqui, uma coincidência que vale a pena notar mas em que não nos apoiamos.)

**Passo 4 — calcule BᵀAᵀ.**

    BᵀAᵀ = [ 0·1+1·2   0·3+1·4 ]   [ 2  4 ]
           [ 1·1+0·2   1·3+0·4 ] = [ 1  3 ]

**Conclusão.** (AB)ᵀ = [ 2 4 ; 1 3 ] e BᵀAᵀ = [ 2 4 ; 1 3 ], idênticos, confirmando a regra de inversão em números concretos. Note que AᵀBᵀ, calculado para comparação, daria um resultado inteiramente diferente (deixado como exercício para notar que a inversão não é opcional):

```python
import numpy as np
A = np.array([[1, 2], [3, 4]])
B = np.array([[0, 1], [1, 0]])
print((A @ B).T)      # [[2 4] [1 3]]
print(B.T @ A.T)       # [[2 4] [1 3]]  -- corresponde
print(A.T @ B.T)       # resultado diferente -- confirma que a ordem importa
```

### Exemplo 3 — provando que AᵀA é simétrica em um exemplo não quadrado

**Problema.** Seja A = [ 1 0 ; 2 1 ; 0 3 ] (3×2, uma matriz não quadrada). Calcule AᵀA e confirme que é simétrica.

**Passo 1 — calcule Aᵀ.**

    Aᵀ = [ 1  2  0 ]     (2×3)
         [ 0  1  3 ]

**Passo 2 — calcule AᵀA** (uma 2×3 vezes uma 3×2, dando um resultado 2×2):

    (AᵀA)[1,1] = (1)(1)+(2)(2)+(0)(0) = 1+4+0 = 5
    (AᵀA)[1,2] = (1)(0)+(2)(1)+(0)(3) = 0+2+0 = 2
    (AᵀA)[2,1] = (0)(1)+(1)(2)+(3)(0) = 0+2+0 = 2
    (AᵀA)[2,2] = (0)(0)+(1)(1)+(3)(3) = 0+1+9 = 10

    AᵀA = [ 5   2 ]
          [ 2  10 ]

**Conclusão.** As entradas fora da diagonal, (AᵀA)[1,2] = 2 e (AᵀA)[2,1] = 2, são iguais, confirmando AᵀA = (AᵀA)ᵀ, essa matriz é simétrica, exatamente como a prova geral na Teoria Central garante, apesar de a própria A ser uma matriz 3×2 comum sem estrutura especial alguma. Este é o cálculo exato subjacente, por exemplo, a uma matriz de Gram construída a partir de três pontos de dados registrados em duas características cada.

```python
import numpy as np
A = np.array([[1, 0], [2, 1], [0, 3]])
G = A.T @ A
print(G)              # [[ 5  2] [ 2 10]]
print(np.allclose(G, G.T))   # True -- simétrica
```

## Equívocos Comuns e Armadilhas

- **"(AB)ᵀ = AᵀBᵀ."** A identidade correta inverte a ordem: (AB)ᵀ = BᵀAᵀ. O Exemplo 2 confirma isso em números concretos e também mostra que AᵀBᵀ, calculado para os mesmos A e B, produz um resultado diferente (e geralmente nem sequer significativamente relacionado), isso não é uma preferência notacional menor, muda a resposta.
- **"Apenas matrizes quadradas têm uma transposta."** Qualquer matriz m×n tem uma transposta n×m bem definida, independentemente de m ser igual a n, o Exemplo 1 transpõe uma matriz 2×3 em uma 3×2 sem problema. É a *simetria* (A = Aᵀ) que especificamente exige uma matriz quadrada, não a própria operação de transposição.
- **"AᵀA só faz sentido, ou só é simétrica, quando A é quadrada ou já simétrica."** O Exemplo 3 usa uma matriz 3×2 (não quadrada) sem nenhuma simetria própria, e AᵀA ainda sai simétrica, a prova na Teoria Central não coloca nenhuma restrição sobre A de forma alguma. Essa garantia incondicional é exatamente por que matrizes de Gram e covariância, construídas a partir de matrizes de dados arbitrárias, sempre podem ser confiadas como simétricas.
- **"Uma matriz simétrica é aquela onde as linhas e colunas são iguais, como uma matriz cheia de valores repetidos."** Simetria é especificamente sobre espelhar pela diagonal principal, A[i,j] = A[j,i], não sobre linhas e colunas conterem os mesmos números umas das outras em qualquer outro padrão. Uma matriz com linhas de aparência muito diferente ainda pode ser simétrica, desde que cada par de entradas fora da diagonal se espelhe corretamente (o resultado do Exemplo 3, [ 5 2 ; 2 10 ], tem duas entradas diagonais muito diferentes e ainda é simétrico).

## Resumo

A transposta Aᵀ reflete uma matriz pela sua diagonal principal, trocando linhas por colunas e transformando uma matriz m×n em uma n×m; ela se desfaz sob repetição ((Aᵀ)ᵀ = A), distribui sobre soma e multiplicação por escalar sem complicação, mas inverte a ordem quando aplicada a um produto: (AB)ᵀ = BᵀAᵀ, ecoando a inversão idêntica vista com inversas de matriz no conceito anterior. Uma matriz simétrica satisfaz A = Aᵀ e deve ser quadrada, e uma das fontes mais importantes de matrizes simétricas é inteiramente incondicional: AᵀA é simétrica para qualquer matriz A, quadrada ou não, um fato que sustenta matrizes de Gram em mínimos quadrados e matrizes de covariância ao longo da estatística e do aprendizado de máquina. Este conceito planta mais um ponteiro para frente que vale a pena carregar adiante: um conceito posterior nesta disciplina mostra que matrizes simétricas gozam de um comportamento de autovalor incomumente limpo, sempre autovalores reais, sempre autovetores ortogonais, uma garantia que falha para matrizes quadradas gerais e que torna simetria uma das propriedades mais consequentes que uma matriz pode ter.

## Documentation Links

- [Stanford CS229 — Linear Algebra Review and Reference](https://cs229.stanford.edu/section/cs229-linalg.pdf) — doc
- [MIT 18.06 — Course Home (OCW)](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) — doc
