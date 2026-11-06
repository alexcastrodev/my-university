---
version: 1.0
updatedAt: 2026-11-04
title: "Cinemática de Velocidade e o Jacobiano"
summary: "Velocidade linear e angular do efetuador final, a montagem do Jacobiano geométrico a partir da cadeia e como ele difere do Jacobiano analítico."
---
## Objetivos de Aprendizagem

- Escrever a velocidade do efetuador final como $\mathbf v=J_v(\mathbf q)\dot{\mathbf q}$ e $\boldsymbol\omega=J_\omega(\mathbf q)\dot{\mathbf q}$, e ler cada coluna do Jacobiano como o movimento produzido por uma junta sozinha.
- Montar o Jacobiano geométrico coluna por coluna a partir dos frames dos elos, com a regra rotativa $\big(\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1}),\ \mathbf z_{i-1}\big)$ e a regra prismática $(\mathbf z_{i-1},\ \mathbf 0)$.
- Conferir um Jacobiano contra diferenças finitas centradas, inclusive as linhas angulares, e escolher o passo.
- Definir o Jacobiano analítico, relacioná-lo ao geométrico pela matriz $T$ dos ângulos de orientação escolhidos e dizer quando os dois coincidem e quando divergem.

## Contexto e Motivação

A cinemática direta responde "onde está a ferramenta". O controle precisa de "com que velocidade a ferramenta se move quando as juntas se movem", porque motores recebem comandos em velocidade de junta e tarefas são escritas em velocidades cartesianas. `inverse-kinematics-and-workspace` já usou a resposta dentro do método de Newton: a matriz de derivadas parciais $J=\partial f/\partial\mathbf q$ de um braço planar. Aquela matriz saiu de derivar uma fórmula, o que funciona para posição. Orientação é diferente. Uma matriz de rotação não é um vetor, e sua taxa de variação é descrita por uma velocidade angular $\boldsymbol\omega$ que, em geral, não é a derivada de três números quaisquer. Esta lição monta o Jacobiano direto da geometria da cadeia, com as linhas de $\boldsymbol\omega$, e o confere numericamente.

## Teoria Central

Convenções: frames DH clássicos como em `the-denavit-hartenberg-convention`, então a junta $i$ gira em torno de $\mathbf z_{i-1}$ ou desliza ao longo dele, com origem $\mathbf o_{i-1}$. Todos os vetores estão expressos no frame da base. O ponto da ferramenta é $\mathbf p$. O Jacobiano empilha as linhas lineares em cima, $J=\begin{pmatrix}J_v\\J_\omega\end{pmatrix}$. O Modern Robotics empilha ao contrário, com as angulares em cima.

### Cinemática de velocidade é a regra da cadeia

Se $\mathbf p=\mathbf p(\mathbf q(t))$, a regra da cadeia em várias variáveis de `partial-derivatives-and-the-multivariable-chain-rule` dá $\dot{\mathbf p}=\sum_i(\partial\mathbf p/\partial q_i)\,\dot q_i$, um termo por caminho de $\mathbf p$ até $t$. Então a coluna $i$ de $J_v$ é a velocidade da ponta quando a junta $i$ se move com taxa unitária e todas as outras estão paradas. A relação é linear em $\dot{\mathbf q}$ e não linear em $\mathbf q$: a matriz muda com a postura.

### Montando o Jacobiano geométrico coluna por coluna

Uma taxa unitária numa junta rotativa gira tudo o que vem depois dela em torno do eixo $\mathbf z_{i-1}$ que passa por $\mathbf o_{i-1}$. Um corpo rígido girando com $\boldsymbol\omega$ em torno de um eixo que passa por $\mathbf o$ move seu ponto $\mathbf p$ com velocidade $\boldsymbol\omega\times(\mathbf p-\mathbf o)$. Uma taxa unitária numa junta prismática desliza tudo o que vem depois ao longo de $\mathbf z_{i-1}$, sem girar. Daí

$$J_i=\begin{pmatrix}\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1})\\ \mathbf z_{i-1}\end{pmatrix}\ \text{(rotativa)},\qquad J_i=\begin{pmatrix}\mathbf z_{i-1}\\ \mathbf 0\end{pmatrix}\ \text{(prismática)}.$$

As velocidades angulares de uma cadeia serial se somam, cada junta contribuindo com seu eixo vezes sua taxa, então as linhas angulares são simplesmente os eixos das juntas. Tudo o que é preciso, $\mathbf z_{i-1}$ e $\mathbf o_{i-1}$, é a terceira e a quarta coluna de ${}^0T_{i-1}$, que a cinemática direta já calcula. Na convenção modificada a junta $i$ fica em $\mathbf z_i$, na origem $\mathbf o_i$, e a mesma regra vale com esse índice.

### Nomes: o que "geométrico" quer dizer onde

Este Jacobiano de $(\dot{\mathbf p},\boldsymbol\omega)$ é o que muitos textos chamam de Jacobiano geométrico. O Modern Robotics usa esse nome para os Jacobianos espacial e de corpo, que levam $\dot{\mathbf q}$ a um twist, e observa numa nota de rodapé que o termo também já foi usado para esta forma mista, que ele chama de "hybrid". A diferença está só na parte linear. A parte linear do Jacobiano espacial é a velocidade $\mathbf v_s$ do ponto do corpo móvel que está momentaneamente na origem da base, e $\dot{\mathbf p}=\mathbf v_s+\boldsymbol\omega\times\mathbf p$. Antes de comparar um Jacobiano com outra fonte, confira qual velocidade ele produz.

### O Jacobiano analítico

Suponha a orientação descrita por três ângulos $\boldsymbol\phi$, por exemplo ângulos ZYX com $R=\mathrm{Rot}_z(\alpha)\,\mathrm{Rot}_y(\beta)\,\mathrm{Rot}_x(\gamma)$ (guinada, arfagem, rolagem, em torno dos eixos móveis). Derivar $\boldsymbol\phi(\mathbf q)$ dá o **Jacobiano analítico** $J_A=\partial(\mathbf p,\boldsymbol\phi)/\partial\mathbf q$. As taxas dos ângulos e $\boldsymbol\omega$ se relacionam por $\boldsymbol\omega=T(\boldsymbol\phi)\dot{\boldsymbol\phi}$, em que cada coluna de $T$ é o eixo de uma rotação elementar, expresso no frame da base:

$$T=\begin{pmatrix}\mathbf e_z & \mathrm{Rot}_z(\alpha)\mathbf e_y & \mathrm{Rot}_z(\alpha)\mathrm{Rot}_y(\beta)\mathbf e_x\end{pmatrix}=\begin{pmatrix}0&-s_\alpha&c_\alpha c_\beta\\0&c_\alpha&s_\alpha c_\beta\\1&0&-s_\beta\end{pmatrix},\qquad \det T=-c_\beta.$$

Portanto

$$J_A=\begin{pmatrix}I&0\\0&T(\boldsymbol\phi)^{-1}\end{pmatrix}J,$$

válido onde $T$ é invertível. Três consequências:

- As linhas lineares sempre coincidem, porque os dois Jacobianos usam $\dot{\mathbf p}$ no frame da base.
- As linhas angulares só coincidem quando $T=I$. Um braço planar é o caso típico: seu único ângulo de orientação $\phi=\theta_1+\theta_2+\theta_3$ tem $\dot\phi=\omega_z$.
- Em $\beta=\pm90^\circ$, $T$ é singular e $J_A$ não existe, mesmo que o braço gire livremente. É uma **singularidade de representação**, propriedade dos ângulos escolhidos e não do robô. Toda sequência de ângulos de Euler tem uma, em algum valor do ângulo do meio.

O Jacobiano analítico é o necessário quando a tarefa está escrita nesses ângulos, por exemplo num controlador que segue uma trajetória em guinada, arfagem e rolagem. O geométrico é o necessário para perguntas físicas, como a velocidade da ferramenta, as forças via $J^T$ e as singularidades do robô.

## Exemplos Resolvidos

### Exemplo 1: o braço articulado, coluna por coluna

Use o braço e a tabela de `the-denavit-hartenberg-convention` ($d_1=0{,}4$ m, $a_2=0{,}5$ m, $a_3=0{,}4$ m, comprimentos supostos) em $\mathbf q=(30^\circ,45^\circ,-60^\circ)$. Dos frames já calculados lá:

```text
i   eixo z_(i-1)            origem o_(i-1)            p - o_(i-1)
1   (0, 0, 1)               (0, 0, 0)                 (0.6408, 0.3700,  0.6500)
2   (0.5, -0.866, 0)        (0, 0, 0.4)               (0.6408, 0.3700,  0.2500)
3   (0.5, -0.866, 0)        (0.3062, 0.1768, 0.7536)  (0.3346, 0.1932, -0.1035)
```

Fazendo os produtos vetoriais,

$$J=\begin{pmatrix}-0{,}3700&-0{,}2165&0{,}0897\\0{,}6408&-0{,}1250&0{,}0518\\0&0{,}7399&0{,}3864\\0&0{,}5&0{,}5\\0&-0{,}866&-0{,}866\\1&0&0\end{pmatrix}.$$

Leia as colunas. A junta 1 move a ponta na horizontal, perpendicular ao braço, com velocidade igual ao alcance horizontal $r=0{,}7399$ m, e não tem efeito vertical. As juntas 2 e 3 têm eixos na mesma direção, então suas colunas angulares são iguais. A coluna linear da junta 2 tem componente vertical $0{,}7399$, de novo o alcance horizontal, porque o ombro levanta a ponta na proporção de quão longe ela está. As mesmas colunas saem de derivar a fórmula de posição daquela lição: $\partial\mathbf p/\partial\theta_1=(-s_1r,\ c_1r,\ 0)=(-0{,}3700;\ 0{,}6408;\ 0)$.

Para uma velocidade de junta $\dot{\mathbf q}=(0{,}2;\ -0{,}1;\ 0{,}3)$ rad/s, $J\dot{\mathbf q}=(-0{,}0254;\ 0{,}1562;\ 0{,}0419\ \text{m/s};\ 0{,}1;\ -0{,}1732;\ 0{,}2\ \text{rad/s})$.

### Exemplo 2: conferindo contra diferenças finitas

Linhas de posição: perturbe uma junta em $\pm h$ e calcule $\big(\mathbf p(\mathbf q+h\mathbf e_i)-\mathbf p(\mathbf q-h\mathbf e_i)\big)/2h$. Linhas angulares: as matrizes de rotação não são vetores, mas $\dot R\,R^T$ é a matriz antissimétrica de $\boldsymbol\omega$, então tome $\dot R\approx\big(R(\mathbf q+h\mathbf e_i)-R(\mathbf q-h\mathbf e_i)\big)/2h$ e leia $\boldsymbol\omega$ nas entradas $(3,2)$, $(1,3)$, $(2,1)$ de $\dot RR^T$. A maior diferença em relação ao $J$ geométrico, nas 18 entradas:

```text
h          1e-2      1e-4      1e-6      1e-8      1e-10
max diff   1.7e-05   1.7e-09   7.0e-11   ~1e-08    ~5e-07 a 9e-07
```

A diferença centrada tem erro de truncamento da ordem de $h^2$, que domina à esquerda, e erro de arredondamento da ordem de $\varepsilon_{\text{mach}}/h$, que domina à direita. As duas últimas entradas são ruído de arredondamento: seus dígitos mudam com o jeito de programar a cinemática direta, só a ordem de grandeza é estável. O melhor passo fica perto de $h=10^{-6}$, mais ou menos a raiz cúbica da precisão de máquina. Um erro de índice nas origens, usar $\mathbf o_i$ no lugar de $\mathbf o_{i-1}$ (fácil ao trocar de convenção), aparece como uma entrada errada por $0{,}39$, nove ordens de grandeza acima desse piso. Uma conferência no tempo também bate: $\big(\mathbf p(\mathbf q+\dot{\mathbf q}\,\delta)-\mathbf p(\mathbf q-\dot{\mathbf q}\,\delta)\big)/2\delta$ com $\delta=10^{-6}$ s reproduz $(-0{,}0254;\ 0{,}1562;\ 0{,}0419)$ m/s.

A relação da seção sobre nomes também se confirma aqui: para cada coluna, $-\mathbf z_{i-1}\times\mathbf o_{i-1}$ (a parte linear do Jacobiano espacial) mais $\mathbf z_{i-1}\times\mathbf p$ reproduz a coluna correspondente de $J_v$.

### Exemplo 3: uma junta prismática

Use o SCARA de `the-denavit-hartenberg-convention` (altura do ombro suposta de $0{,}5$ m, elos de $0{,}4$ m e $0{,}3$ m) em $(30^\circ,45^\circ,0{,}1\text{ m})$, com ponta $\mathbf p=(0{,}4241;\ 0{,}4898;\ 0{,}4000)$. Eixos $\mathbf z_0=\mathbf z_1=(0,0,1)$ com origens $(0,0,0)$ e $(0{,}3464;\ 0{,}2;\ 0{,}5)$, e $\mathbf z_2=(0,0,-1)$ porque o curso positivo da haste é para baixo.

$$J=\begin{pmatrix}-0{,}4898&-0{,}2898&0\\0{,}4241&0{,}0776&0\\0&0&-1\\0&0&0\\0&0&0\\1&1&0\end{pmatrix}.$$

A terceira coluna é só $\mathbf z_2$ em cima e zeros embaixo: deslizar desce a ferramenta a 1 m/s por m/s e não a gira. As linhas 4 e 5 são nulas, então esse braço nunca inclina a ferramenta, e a matriz $6\times3$ tem posto no máximo 3. Diferenças finitas com $h=10^{-6}$ concordam até $7{,}0\times10^{-11}$.

### Exemplo 4: geométrico versus analítico, longe de qualquer singularidade

Para o braço articulado em $(30^\circ,45^\circ,-60^\circ)$, os ângulos ZYX da ferramenta são $(\alpha,\beta,\gamma)=(30^\circ,15^\circ,90^\circ)$: a guinada é $\theta_1$, a arfagem é $-(\theta_2+\theta_3)$, a rolagem fica em $90^\circ$. Então as linhas angulares de $J_A$ são

$$\begin{pmatrix}1&0&0\\0&-1&-1\\0&0&0\end{pmatrix},\qquad\text{enquanto}\qquad J_\omega=\begin{pmatrix}0&0{,}5&0{,}5\\0&-0{,}866&-0{,}866\\1&0&0\end{pmatrix}.$$

As duas estão certas e respondem a perguntas diferentes: $J_A$ dá taxas de ângulo, $J_\omega$ dá o giro físico. Diferenças finitas dos ângulos ZYX extraídos reproduzem $T^{-1}J_\omega$ até $8{,}4\times10^{-11}$. As linhas lineares são idênticas.

### Exemplo 5: quando só o Jacobiano analítico explode

Tome um punho de três juntas com $R=\mathrm{Rot}_z(q_1)\mathrm{Rot}_y(q_2)\mathrm{Rot}_z(q_3)$, todas rotativas. Seu Jacobiano angular tem colunas $\mathbf e_z$, $\mathrm{Rot}_z(q_1)\mathbf e_y$ e $\mathrm{Rot}_z(q_1)\mathrm{Rot}_y(q_2)\mathbf e_z$, confirmadas por diferenças finitas até $8\times10^{-11}$. Descreva sua orientação com ângulos ZYX e leve-o até $\mathbf q=(20^\circ,90^\circ,0)$, onde a arfagem ZYX chega a $90^\circ$:

```text
q2      cond(J_omega)   max |entrada de J_A|   taxas ZYX para qdot = (0.1, 0.1, 0.1) rad/s
40*     2.75            1.1
80      1.19            5.8                    (0.68, 0.10, 0.57)
89      1.018           57.3                   (5.83, 0.10, 5.73)
89.9    1.0017          573                    (57.40, 0.10, 57.30)
```

(* linha com $q_3=30^\circ$, as outras com $q_3=0$.) Em $q_2=89{,}9^\circ$ o punho está quase perfeitamente condicionado, gira a $\lvert\boldsymbol\omega\rvert=0{,}173$ rad/s, e mesmo assim guinada e rolagem precisam variar a cerca de 57 rad/s cada. Perto da arfagem de $90^\circ$ o eixo da guinada e o da rolagem apontam em direções quase opostas, então essas duas taxas grandes quase se cancelam. Um controlador escrito em ângulos ZYX veria uma falha que o hardware não tem.

O inverso também acontece. Em $q_2=0$ os eixos das juntas 1 e 3 se alinham, $J_\omega$ tem valores singulares $(1{,}414;\ 1;\ 0)$, e o punho de fato não consegue girar em torno de uma direção. Isso é uma singularidade do robô, assunto de `singularities-and-manipulability`. Os dois tipos se distinguem perguntando qual matriz perde posto: $J$ (o robô) ou $T$ (os ângulos).

## Equívocos Comuns e Armadilhas

- **"Velocidade angular é a derivada dos ângulos de Euler."** É $T(\boldsymbol\phi)$ vezes essa derivada. No Exemplo 4 as duas diferem numa postura comum.
- **"Os Jacobianos geométrico e analítico diferem em tudo."** As linhas lineares são sempre iguais, e num braço planar a linha angular também.
- **"Uma explosão em $J_A$ quer dizer robô singular."** No Exemplo 5 o punho tinha número de condição $1{,}0017$ enquanto $J_A$ tinha entradas de 573.
- **"Colunas prismáticas são como as rotativas."** Elas têm o eixo nas linhas lineares, zeros nas angulares, e nenhum produto vetorial.
- **"Qualquer passo de diferença finita serve."** O erro foi $1{,}7\times10^{-5}$ com $h=10^{-2}$ e da ordem de $10^{-6}$ com $h=10^{-10}$, contra $7\times10^{-11}$ perto de $10^{-6}$.
- **"O Jacobiano geométrico é o mesmo em todo livro."** O Modern Robotics chama assim um Jacobiano de twist, cuja parte linear não é $\dot{\mathbf p}$. Confira a velocidade antes de comparar números.

## Resumo

O Jacobiano leva taxas de junta à velocidade do efetuador final, e sua coluna $i$ é o movimento produzido só pela junta $i$. A partir dos frames dos elos, uma junta rotativa contribui com $\mathbf z_{i-1}\times(\mathbf p-\mathbf o_{i-1})$ nas linhas lineares e $\mathbf z_{i-1}$ nas angulares, e uma prismática com $\mathbf z_{i-1}$ e zeros. Para o braço articulado e o SCARA essas colunas bateram com diferenças centradas até $7\times10^{-11}$ no melhor passo, $h=10^{-6}$. O Jacobiano analítico deriva um conjunto escolhido de ângulos de orientação e vale $\operatorname{diag}(I,T^{-1})J$: mesmas linhas lineares, linhas angulares diferentes a menos que $T=I$ como num braço planar, e explosão onde $T$ é singular. Um punho em ZYX perto da arfagem de $90^\circ$ mostrou taxas de ângulo de 57 rad/s enquanto o hardware girava a $0{,}17$ rad/s, bem condicionado.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): o Capítulo 5 deduz os Jacobianos espacial e de corpo, e a Seção 5.1.5 define o Jacobiano analítico e o relaciona ao geométrico.
- [MIT OpenCourseWare 2.12, Asada, Chapter 5: Differential Motion](https://ocw.mit.edu/courses/2-12-introduction-to-robotics-fall-2005/resources/chapter5/): o Jacobiano de braços planares como relação diferencial, a interpretação das colunas e suas propriedades.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): o Capítulo 3, Seção 4.1, deduz a velocidade do efetuador final e o Jacobiano do manipulador a partir de twists.
