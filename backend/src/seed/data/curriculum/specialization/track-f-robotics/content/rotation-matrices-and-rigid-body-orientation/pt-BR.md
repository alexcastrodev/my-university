---
version: 1.0
updatedAt: 2026-11-04
title: "Matrizes de Rotação e Orientação de Corpos Rígidos"
summary: "Matrizes de rotação e suas propriedades, composição de rotações em torno de eixos fixos e móveis, ângulos de Euler e roll-pitch-yaw, e gimbal lock."
---
## Objetivos de Aprendizagem

- Ler uma matriz de rotação como os eixos de um referencial escritos em outro e conferir as duas condições que a definem, $R^TR=I$ e $\det R=1$.
- Usar a mesma matriz de forma ativa (girar um vetor) e passiva (reescrever um vetor fixo num referencial girado), prevendo a diferença de sinal.
- Compor rotações em torno de eixos fixos por pré-multiplicação e em torno dos eixos móveis do corpo por pós-multiplicação.
- Enunciar a convenção de Euler ZYX usada nesta trilha, reconhecer que ela é igual ao roll-pitch-yaw em torno de eixos fixos na ordem inversa, e ver uma convenção de biblioteca dar outra matriz para os mesmos três números.
- Mostrar o gimbal lock como perda de posto do mapa das taxas dos ângulos de Euler para a velocidade angular, e medir o que ele faz com os ângulos perto do travamento.

## Contexto e Motivação

`what-a-robot-is-classification-components-and-degrees-of-freedom` contou 6 graus de liberdade para um corpo rígido no espaço: 3 de posição e 3 de orientação. Posição é um vetor. Orientação precisa de uma representação, e todo cálculo posterior desta trilha (poses, jacobianos, controladores) herda a que for escolhida aqui.

`orthogonality-and-orthogonal-matrices` mostrou que uma matriz quadrada de colunas ortonormais satisfaz $Q^{-1}=Q^T$ e que essas matrizes são rotações, reflexões ou combinações das duas. A robótica precisa só das rotações, e precisa ser explícita sobre quatro convenções que livros e bibliotecas escolhem de jeitos diferentes: em que sentido a matriz age, a que referencial pertence um eixo, a ordem dos ângulos de Euler e o sinal de um ângulo. Misturar duas delas dá uma matriz de rotação com cara de válida e orientação errada, e nada na própria matriz denuncia o erro.

## Teoria Central

### Convenções usadas nesta trilha

Vetores são colunas. Referenciais são dextrógiros, e um ângulo positivo gira no sentido anti-horário quando o eixo aponta para quem olha. Seguindo o *Modern Robotics* (Lynch e Park), $R_{sb}$ é a orientação do referencial $\{b\}$ em relação a $\{s\}$: suas colunas são os eixos unitários $\hat x_b,\hat y_b,\hat z_b$ escritos em coordenadas de $\{s\}$. As rotações elementares são

$$R_x(\theta)=\begin{pmatrix}1&0&0\\0&c&-s\\0&s&c\end{pmatrix},\quad R_y(\theta)=\begin{pmatrix}c&0&s\\0&1&0\\-s&0&c\end{pmatrix},\quad R_z(\theta)=\begin{pmatrix}c&-s&0\\s&c&0\\0&0&1\end{pmatrix},$$

com $c=\cos\theta$ e $s=\sin\theta$. O sinal de menos em $R_y$ fica no canto inferior esquerdo, ao contrário das outras duas, porque a ordem cíclica numa rotação em torno de $y$ é $z\to x$.

### O grupo SO(3)

Colunas unitárias dão 3 equações e colunas ortogonais duas a duas dão mais 3, juntas $R^TR=I$. Nove entradas menos seis restrições deixam 3 parâmetros livres, o que bate com a contagem da lição anterior. Essas seis restrições admitem $\det R=\pm1$; exigir $\det R=+1$ mantém os referenciais dextrógiros e exclui as reflexões. O conjunto dessas matrizes é o grupo especial ortogonal $SO(3)$. O produto de rotações é rotação, a inversa é a transposta, uma rotação preserva comprimentos e, em três dimensões, $R_1R_2\neq R_2R_1$ em geral (rotações no plano comutam).

### Três usos, e ativo versus passivo

O *Modern Robotics* lista três usos de uma matriz de rotação: representar uma orientação, mudar o referencial em que um vetor está escrito e girar um vetor ou referencial. Os dois últimos são as leituras conhecidas como passiva (alias) e ativa (alibi).

- **Ativa**: o vetor se move, o referencial fica. $v'=Rv$ dá as coordenadas do vetor girado no mesmo referencial.
- **Passiva**: o vetor fica, o referencial muda. Se $v_b$ são as coordenadas de um vetor em $\{b\}$, então $v_s=R_{sb}v_b$, e as coordenadas no referencial girado são $v_b=R_{sb}^Tv_s$.

A mesma $R$ age, portanto, com sinal oposto nas duas leituras: girar um vetor de $+\theta$ produz os mesmos números que descrever o vetor parado num referencial girado de $-\theta$. Mudanças de referencial se encadeiam cancelando os índices internos, $R_{ab}R_{bc}=R_{ac}$ e $R_{ab}v_b=v_a$.

### Eixos fixos e eixos móveis

Girar um referencial $\{b\}$ por $R=\operatorname{Rot}(\hat\omega,\theta)$ é ambíguo até se dizer em que referencial $\hat\omega$ está escrito:

$$R_{sb'}=R\,R_{sb}\quad(\hat\omega\text{ no referencial fixo }\{s\}),\qquad R_{sb''}=R_{sb}\,R\quad(\hat\omega\text{ no referencial do corpo }\{b\}).$$

Assim, rotações sucessivas em torno de eixos fixos se acumulam à esquerda, e rotações sucessivas em torno dos eixos do próprio corpo, que se movem com ele, se acumulam à direita.

### Ângulos de Euler: a convenção ZYX

Esta trilha usa os **ângulos de Euler ZYX** do *Modern Robotics* (Apêndice B): partindo de $\{b\}$ alinhado com $\{s\}$, gire $\alpha$ em torno do $\hat z_b$ do corpo, depois $\beta$ em torno do novo $\hat y_b$, depois $\gamma$ em torno do $\hat x_b$ mais recente. Rotações em eixos do corpo pós-multiplicam, então

$$R(\alpha,\beta,\gamma)=R_z(\alpha)R_y(\beta)R_x(\gamma)=\begin{pmatrix}c_\alpha c_\beta&c_\alpha s_\beta s_\gamma-s_\alpha c_\gamma&c_\alpha s_\beta c_\gamma+s_\alpha s_\gamma\\s_\alpha c_\beta&s_\alpha s_\beta s_\gamma+c_\alpha c_\gamma&s_\alpha s_\beta c_\gamma-c_\alpha s_\gamma\\-s_\beta&c_\beta s_\gamma&c_\beta c_\gamma\end{pmatrix}.$$

Lido da direita para a esquerda, o mesmo produto é uma rotação de $\gamma$ em torno do $\hat x_s$ fixo, depois $\beta$ em torno do $\hat y_s$ fixo, depois $\alpha$ em torno do $\hat z_s$ fixo. O *Modern Robotics* chama isso de ângulos roll-pitch-yaw XYZ: uma matriz, duas histórias físicas. Quando $\cos\beta\neq0$, os ângulos voltam por

$$\beta=\operatorname{atan2}\!\big(-r_{31},\sqrt{r_{11}^2+r_{21}^2}\big),\quad\alpha=\operatorname{atan2}(r_{21},r_{11}),\quad\gamma=\operatorname{atan2}(r_{32},r_{33}),$$

com $\beta\in[-90°,90°]$. Outros textos usam ZYZ, XYZ ou outras ordens, e as bibliotecas codificam a diferença numa string. No `Rotation.from_euler` do SciPy, letras maiúsculas indicam eixos intrínsecos (do corpo) e minúsculas, extrínsecos (fixos). Então `'ZYX'` é a convenção acima, enquanto `'zyx'` com os mesmos três números é $R_x(\gamma)R_y(\beta)R_z(\alpha)$, outra rotação.

### Gimbal lock

Em $\beta=\pm90°$ o primeiro e o terceiro eixos de rotação se alinham, e a matriz depende só de $\alpha-\gamma$ (para $\beta=+90°$) ou de $\alpha+\gamma$ (para $\beta=-90°$). Só uma combinação do primeiro e do terceiro ângulos importa, então as coordenadas perdem uma dimensão. O jeito mais limpo de ver a perda é pelas velocidades. A velocidade angular em $\{s\}$ produzida pelas taxas dos ângulos é

$$\omega_s=E(\alpha,\beta)\begin{pmatrix}\dot\alpha\\\dot\beta\\\dot\gamma\end{pmatrix},\qquad E=\Big(\hat z\;\;\;R_z(\alpha)\hat y\;\;\;R_z(\alpha)R_y(\beta)\hat x\Big),$$

em que cada coluna é um eixo de rotação, escrito em $\{s\}$, no momento em que o seu ângulo age. O determinante é $-\cos\beta$. Em $\beta=\pm90°$ a terceira coluna é $\mp$ a primeira, $E$ tem posto 2, velocidades angulares fora da sua imagem bidimensional não podem ser produzidas por nenhuma taxa de ângulo, e perto do travamento exigem taxas muito grandes. Nada acontece com a rotação em si: $SO(3)$ é igual em todo ponto, e a singularidade é das coordenadas, assim como os polos são da latitude e longitude e não da esfera. O *Modern Robotics* observa que singularidades assim são inevitáveis em qualquer representação de rotação com três parâmetros, um motivo para guardar a orientação como matriz ou quatérnio unitário (ambos tratados no *Modern Robotics*) e deixar os ângulos de Euler para entrada e exibição.

## Exemplos Resolvidos

### Exemplo 1: conferindo que uma matriz é uma rotação

$R=R_z(30°)R_y(20°)R_x(10°)$ resulta em

$$R=\begin{pmatrix}0{,}8138&-0{,}4410&0{,}3785\\0{,}4698&0{,}8826&0{,}0180\\-0{,}3420&0{,}1632&0{,}9254\end{pmatrix}.$$

Em float64, $\lVert R^TR-I\rVert_F=3{,}2\times10^{-17}$ e $\det R=1{,}0000000000000002$. Para $x=(1,2,2)$, $\lVert x\rVert=\lVert Rx\rVert=3$. O espelho $\operatorname{diag}(1,1,-1)$ também satisfaz $F^TF=I$, mas $\det F=-1$: é ortogonal e não é rotação, e transformaria um referencial dextrógiro num levógiro.

### Exemplo 2: ativa e passiva com a mesma matriz

Sejam $R=R_z(30°)$ e $v=(1,0,0)$.

```text
active,  R v      = ( 0.866,  0.5,  0)   the vector turned 30 degrees
passive, R^T v    = ( 0.866, -0.5,  0)   the same vector, in a frame turned 30 degrees
dot with b axes   = ( 0.866, -0.5,  0)   direct check: projections on the columns of R
```

A segunda componente troca de sinal. Um programa que chama `R @ v` quando precisava das coordenadas no novo referencial produz exatamente esse erro, e o resultado continua sendo um vetor unitário, então nenhuma checagem de comprimento o pega.

### Exemplo 3: a mesma rotação em torno de um eixo fixo e de um eixo do corpo

Seja $R_{sb}=R_z(90°)$, de modo que o $\hat x_b$ do corpo aponta ao longo do $\hat y_s$ fixo. Aplique $R_x(90°)$ dos dois jeitos:

$$R_x(90°)R_{sb}=\begin{pmatrix}0&-1&0\\0&0&-1\\1&0&0\end{pmatrix},\qquad R_{sb}R_x(90°)=\begin{pmatrix}0&0&1\\1&0&0\\0&1&0\end{pmatrix}.$$

As duas orientações diferem. A pós-multiplicação girou o corpo em torno do próprio $\hat x_b$, que é o $\hat y_s$ fixo, e o script confirma $R_{sb}R_x(90°)=R_y(90°)R_{sb}$ exatamente. Girar em torno de um eixo do corpo é o mesmo que girar em torno do lugar para onde esse eixo aponta, naquele momento, no referencial fixo.

### Exemplo 4: ZYX versus zyx

Com $(\alpha,\beta,\gamma)=(30°,20°,10°)$:

```text
Rz Ry Rx (this track)           scipy 'zyx' (extrinsic z, then y, then x)
[ 0.8138 -0.4410  0.3785]       [ 0.8138 -0.4698  0.3420]
[ 0.4698  0.8826  0.0180]       [ 0.5438  0.8232 -0.1632]
[-0.3420  0.1632  0.9254]       [-0.2049  0.3188  0.9254]
```

O `'ZYX'` do SciPy coincide com $R_z R_y R_x$ até $2{,}2\times10^{-16}$, e `'xyz'` com os ângulos listados como $(\gamma,\beta,\alpha)$ também coincide, que é a leitura roll-pitch-yaw. O `'zyx'` minúsculo é igual a $R_x(\gamma)R_y(\beta)R_z(\alpha)$ e difere em até 0,181 numa entrada. O eixo $\hat x$ do corpo cai em $(0{,}8138;\ 0{,}4698;\ -0{,}3420)$ numa e em $(0{,}8138;\ 0{,}5438;\ -0{,}2049)$ na outra, a $8{,}9°$ de distância, e as duas orientações diferem por uma rotação de $12{,}0°$, por causa de maiúscula e minúscula. As fórmulas com atan2 recuperam $(30°,20°,10°)$ da primeira matriz.

### Exemplo 5: gimbal lock, rodado

Com $\alpha=30°$, os valores singulares de $E$ e do jacobiano $9\times3$ das entradas de $R$ em relação a $(\alpha,\beta,\gamma)$, em $\gamma=10°$, por diferenças centrais:

```text
beta     det E      singular values of E        rank   singular values of d(vec R)   rank
  0.0   -1.00e+00   1.0000  1.0000  1.0000        3     1.4142  1.4142  1.4142          3
 45.0   -7.07e-01   1.3066  1.0000  0.5412        3     1.8478  1.4142  0.7654          3
 80.0   -1.74e-01   1.4088  1.0000  0.1233        3     1.9924  1.4142  0.1743          3
 89.0   -1.75e-02   1.4142  1.0000  0.0123        3     1.9999  1.4142  0.0175          3
 89.9   -1.75e-03   1.4142  1.0000  0.0012        3     2.0000  1.4142  0.0017          3
 90.0   -6.12e-17   1.4142  1.0000  0.0000        2     2.0000  1.4142  0.0000          2
```

O determinante segue $-\cos\beta$ e o menor valor singular vai a zero, então o posto cai de 3 para 2 em $90°$. Para $E$ o zero é exato. Para o jacobiano por diferenças finitas, o menor valor singular em $90°$ é $3{,}3\times10^{-11}$, ruído da diferença: o posto da tabela usa tolerância $10^{-6}$, e a tolerância padrão de `numpy.linalg.matrix_rank` daria 3. No travamento, os ângulos $(10°,90°,0°)$ e $(40°,90°,30°)$ dão matrizes que concordam até $8{,}3\times10^{-17}$ (mesmo $\alpha-\gamma$), enquanto $(40°,90°,-30°)$ difere em 0,766. O `as_euler('ZYX')` do SciPy nessa matriz devolve $(10°,90°,0°)$ com o aviso "Gimbal lock detected. Setting third angle to zero since it is not possible to uniquely determine all angles."

Perto do travamento as coordenadas ficam instáveis. Gire o corpo $0{,}5°$ em torno do próprio $\hat z_b$ e extraia os ângulos de novo:

```text
start (alpha, beta, gamma)   change in alpha   change in beta   change in gamma
(30, 30.0, 10)                   +0.57             -0.09            +0.28
(30, 89.0, 10)                  +24.38             -0.19           +24.37
(30, 89.9, 10)                  +69.22             -0.43           +69.22
```

A rotação física é $0{,}500°$ em todas as linhas, medida como o ângulo de $R_1^TR_2$. Um controlador que interpolasse ou derivasse esses ângulos perto de $\beta=90°$ comandaria giros rápidos e opostos de $\alpha$ e $\gamma$ para um movimento minúsculo.

## Equívocos Comuns e Armadilhas

- **"Toda matriz ortogonal é uma rotação."** O $\operatorname{diag}(1,1,-1)$ do Exemplo 1 é ortogonal com determinante $-1$.
- **"Se R gira o vetor, R também dá as coordenadas dele no referencial girado."** Exemplo 2: a leitura passiva pede $R^T$, e o erro troca um sinal sem mudar comprimento nenhum.
- **"Girar em torno de x dá no mesmo, multiplicando de qualquer lado."** Exemplo 3: o fator à esquerda usa o $x$ fixo, o fator à direita usa o $x$ do corpo, e os resultados diferem.
- **"ZYX quer dizer a mesma coisa em toda biblioteca."** Exemplo 4: o SciPy distingue `'ZYX'` de `'zyx'`, e os mesmos três números produziram orientações a $12{,}0°$ uma da outra. Escreva o produto de matrizes ao lado dos nomes dos ângulos.
- **"Gimbal lock é um estado físico em que o objeto pode ficar preso."** A orientação em $\beta=90°$ é uma rotação comum. Só as coordenadas de três ângulos são singulares ali, como mostra a queda de posto do Exemplo 5.

## Resumo

Uma matriz de rotação $R_{sb}$ guarda os eixos de $\{b\}$ escritos em $\{s\}$ e é definida por $R^TR=I$ com $\det R=1$; o determinante exclui as reflexões. A mesma matriz gira um vetor de forma ativa ($Rv$) ou reescreve um vetor fixo de forma passiva ($R^Tv$), e as duas diferem em sinal. Rotações em torno de eixos fixos pré-multiplicam e rotações em torno de eixos do corpo pós-multiplicam. A convenção de Euler desta trilha é ZYX, $R_z(\alpha)R_y(\beta)R_x(\gamma)$, que também é o roll-pitch-yaw XYZ em torno de eixos fixos, e o `'zyx'` do SciPy é outra rotação para os mesmos números. Em $\beta=\pm90°$ o mapa das taxas dos ângulos para a velocidade angular cai de posto 3 para posto 2, e perto disso um giro de $0{,}5°$ mudou dois ângulos em $69°$. A orientação está bem; as coordenadas é que não estão.

## Documentation Links

- [Modern Robotics, book page (Lynch and Park)](https://hades.mech.northwestern.edu/index.php/Modern_Robotics): o livro-texto gratuito e os vídeos.
- [Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): a Seção 3.2 sobre matrizes de rotação, seus três usos e rotação no referencial fixo versus no do corpo; o Apêndice B sobre ângulos de Euler ZYX, roll-pitch-yaw e o algoritmo de extração dos ângulos.
- [SciPy, Rotation.from_euler](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.from_euler.html): letras maiúsculas para sequências intrínsecas e minúsculas para extrínsecas.
- [SciPy, Rotation.as_euler](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.transform.Rotation.as_euler.html): as faixas dos ângulos e o aviso de gimbal lock que zera o terceiro ângulo.
- [Wikipedia, Active and passive transformation](https://en.wikipedia.org/wiki/Active_and_passive_transformation): as leituras alibi e alias da mesma transformação.
