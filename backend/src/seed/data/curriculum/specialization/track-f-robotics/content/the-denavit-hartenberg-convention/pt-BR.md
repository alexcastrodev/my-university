---
version: 1.0
updatedAt: 2026-11-04
title: "A Convenção de Denavit-Hartenberg"
summary: "Os parâmetros de Denavit-Hartenberg, a atribuição dos frames dos elos passo a passo, a montagem da tabela e a diferença entre as convenções clássica e modificada."
---
## Objetivos de Aprendizagem

- Nomear os quatro parâmetros de Denavit-Hartenberg $a$, $\alpha$, $d$, $\theta$, dizer qual deles é a variável da junta numa junta rotativa e numa prismática, e ler cada um num desenho.
- Atribuir os frames dos elos passo a passo num braço de três juntas, inclusive nos casos de eixos que se cruzam e de eixos paralelos, e preencher a tabela.
- Escrever a transformação de elo da convenção clássica e a da convenção modificada, e dizer qual convenção uma fonte usa.
- Conferir numericamente a cinemática direta calculada pela tabela contra um produto de transformações escrito direto da geometria.
- Reconhecer o que dá errado quando uma tabela escrita numa convenção é aplicada na fórmula da outra.

## Contexto e Motivação

`forward-kinematics-of-serial-manipulators` escreveu a pose do efetuador final como um produto de transformações de elo, e `homogeneous-transformations-for-robot-poses` deu sentido a cada fator: uma matriz $4\times4$ que posiciona um frame dentro de outro. Nada nessa receita diz onde cada frame de elo deve ficar. Com frames colocados livremente, cada transformação de elo precisa de seis números, três de posição e três de orientação.

Denavit e Hartenberg (1955) propuseram regras de colocação dos frames que deixam só quatro números por elo. O Modern Robotics (Lynch e Park, Apêndice C) relata que eles também mostraram que quatro é o mínimo. O ganho é uma tabela compacta: uma linha por junta, uma coluna por parâmetro, uma entrada móvel por linha. Murray, Li e Sastry (1994) observaram que parâmetros DH estavam disponíveis para os robôs industriais comuns e eram usados pela maioria dos sistemas comerciais de simulação e programação, e bibliotecas como a Robotics Toolbox for Python ainda montam modelos de braço a partir deles.

O problema é que duas versões incompatíveis das regras estão em uso, e as duas se chamam "DH". Uma tabela não significa nada sem saber qual delas a escreveu.

## Teoria Central

Vetores são colunas, e a matriz ${}^{i-1}T_i$ dá a pose do frame $\{i\}$ no frame $\{i-1\}$, de modo que $\mathbf p^{(i-1)}={}^{i-1}T_i\,\mathbf p^{(i)}$. Produtos são lidos da esquerda para a direita, como movimentos do frame corrente (móvel). Ângulos são positivos pela regra da mão direita em torno do eixo nomeado. Escreva $c_x=\cos x$ e $s_x=\sin x$.

### A ideia: só movimentos em x e em z

As duas convenções põem um eixo $z$ em cada eixo de junta. Numa junta rotativa, $z$ é o eixo de rotação. Numa prismática, $z$ aponta no sentido positivo do deslocamento. Entre dois eixos de junta consecutivos existe uma **normal comum**, a reta que encontra os dois em ângulo reto, e o eixo $x$ é colocado sobre ela. Com essas duas escolhas, ir de um frame ao seguinte exige só uma rotação e uma translação ao longo de $x$ e uma rotação e uma translação ao longo de $z$. Movimento lateral em $y$ nunca é necessário, e é daí que vem a economia de seis números para quatro.

Os quatro números são:

| parâmetro | nome | como se mede |
|---|---|---|
| $a$ | comprimento do elo | ao longo da normal comum, entre os dois eixos de junta |
| $\alpha$ | torção do elo | ângulo entre os dois eixos de junta, em torno da normal comum |
| $d$ | deslocamento do elo | ao longo de um eixo de junta, entre duas normais comuns consecutivas |
| $\theta$ | ângulo da junta | ângulo entre duas normais comuns consecutivas, em torno de um eixo de junta |

Numa junta rotativa $\theta$ é a variável e $a$, $\alpha$, $d$ são constantes. Numa prismática $d$ é a variável e $\theta$ é constante. As convenções diferem em qual eixo de junta recebe qual índice de frame, e portanto na ordem dos quatro movimentos.

### A convenção clássica

Na convenção clássica (também chamada de padrão ou distal), o eixo da junta $i$ é $z_{i-1}$, e o frame $\{i\}$ fica na ponta de saída do elo $i$. As regras:

1. Ponha $z_{i-1}$ sobre o eixo da junta $i$.
2. Ponha $x_i$ sobre a normal comum que vai de $z_{i-1}$ a $z_i$, com origem $o_i$ no ponto onde essa normal encontra $z_i$.
3. Então $a_i$ é a distância de $z_{i-1}$ a $z_i$ ao longo de $x_i$, $\alpha_i$ o ângulo de $z_{i-1}$ para $z_i$ em torno de $x_i$, $d_i$ a distância de $o_{i-1}$ ao pé de $x_i$ ao longo de $z_{i-1}$, e $\theta_i$ o ângulo de $x_{i-1}$ para $x_i$ em torno de $z_{i-1}$.

A transformação de elo é uma rotação e uma translação ao longo de $z_{i-1}$, seguidas de uma translação e uma rotação ao longo do novo $x$:

$$A_i=\mathrm{Rot}_z(\theta_i)\,\mathrm{Trans}_z(d_i)\,\mathrm{Trans}_x(a_i)\,\mathrm{Rot}_x(\alpha_i)=\begin{pmatrix}c_{\theta_i}&-s_{\theta_i}c_{\alpha_i}&s_{\theta_i}s_{\alpha_i}&a_ic_{\theta_i}\\ s_{\theta_i}&c_{\theta_i}c_{\alpha_i}&-c_{\theta_i}s_{\alpha_i}&a_is_{\theta_i}\\ 0&s_{\alpha_i}&c_{\alpha_i}&d_i\\ 0&0&0&1\end{pmatrix}.$$

### A convenção modificada

Na convenção modificada (também chamada de proximal), o eixo da junta $i$ é $z_i$, e o frame $\{i\}$ fica na ponta de entrada do elo $i$, sobre a própria junta. Os parâmetros mantêm o significado, mas a torção e o comprimento que levam até a junta $i$ recebem o índice $i-1$:

$${}^{i-1}T_i=\mathrm{Rot}_x(\alpha_{i-1})\,\mathrm{Trans}_x(a_{i-1})\,\mathrm{Rot}_z(\theta_i)\,\mathrm{Trans}_z(d_i)=\begin{pmatrix}c_{\theta_i}&-s_{\theta_i}&0&a_{i-1}\\ s_{\theta_i}c_{\alpha_{i-1}}&c_{\theta_i}c_{\alpha_{i-1}}&-s_{\alpha_{i-1}}&-d_is_{\alpha_{i-1}}\\ s_{\theta_i}s_{\alpha_{i-1}}&c_{\theta_i}s_{\alpha_{i-1}}&c_{\alpha_{i-1}}&d_ic_{\alpha_{i-1}}\\0&0&0&1\end{pmatrix}.$$

Uma rotação em torno de $x$ comuta com uma translação ao longo de $x$, e o mesmo vale para $z$, então algumas fontes escrevem os fatores como $\mathrm{Trans}_x\,\mathrm{Rot}_x\,\mathrm{Rot}_z\,\mathrm{Trans}_z$. É a mesma matriz.

### Quem usa qual

- **Modern Robotics** (Lynch e Park), Apêndice C: a forma modificada, com parâmetros $\alpha_{i-1}$, $a_{i-1}$, $d_i$, $\phi_i$ e exatamente a matriz acima. O livro não usa a palavra "modificada". O texto principal usa o produto de exponenciais em vez de DH.
- **Murray, Li e Sastry** (*A Mathematical Introduction to Robotic Manipulation*), Capítulo 3, Seção 2.3: a matriz clássica, com o ângulo da junta escrito $\phi_i$.
- **Documentação da Robotics Toolbox for Python**: as classes `RevoluteDH` e `RevoluteMDH`, e um indicador que é verdadeiro "for modified Denavit-Hartenberg notation (eg. Craig's textbook)" e falso "for standard Denavit-Hartenberg notation (eg. Siciliano, Spong, Paul)".
- **Wikipedia**, "Denavit-Hartenberg parameters": cita o *Introduction to Robotics* de Craig (3ª edição) como livro que usa os parâmetros modificados.

O Modern Robotics também avisa que alguns autores põem o eixo da junta em $x$ em vez de $z$, e conclui que "it is essential to include a concise description of the link frames together with the parameter values."

### Casos especiais

- **Eixos que se cruzam.** Não há normal comum, então $a=0$ e $x$ é tomado perpendicular ao plano dos dois eixos. Qualquer um dos dois sentidos serve, e a escolha troca o sinal de $\alpha$.
- **Eixos paralelos.** Há infinitas normais comuns. Escolha a que zera mais parâmetros, em geral $d=0$.
- **Base e ferramenta.** As regras deixam o primeiro e o último frame parcialmente livres. Escolha-os para zerar parâmetros. Um frame deslocado de lado, ao longo de $y$, não é alcançável com movimentos em $x$ e $z$ (o Modern Robotics dá como exemplo uma translação pura em $y$), então o frame da ferramenta costuma entrar como uma transformação constante extra depois da tabela.

## Exemplos Resolvidos

### Exemplo 1: frames num braço articulado, passo a passo

O braço tem uma junta de base vertical, uma junta de ombro horizontal na altura $d_1=0{,}4$ m e uma junta de cotovelo horizontal paralela ao ombro. O braço superior mede $a_2=0{,}5$ m e o antebraço, até a ponta da ferramenta, $a_3=0{,}4$ m. Comprimentos supostos.

**Passo 1, eixos.** Eixo da junta 1: vertical, passando pela base. Eixo da junta 2: horizontal, perpendicular ao plano do braço. Eixo da junta 3: paralelo ao da junta 2, passando pelo cotovelo.

**Passo 2, eixos $z$ clássicos.** $z_0$ na junta 1, apontando para cima. $z_1$ na junta 2 e $z_2$ na junta 3, os dois no mesmo sentido, escolhido para que $\theta_2$ positivo levante o braço. Com $x_0$ apontando ao longo do braço em $\theta_1=0$, isso dá $z_1=-y_0$ em $\theta_1=0$.

**Passo 3, frame 1.** $z_0$ e $z_1$ se cruzam no ombro, então $a_1=0$ e $o_1$ é o ombro. $x_1$ tem de ser perpendicular aos dois, logo é horizontal e fica no plano do braço. O ângulo de $z_0$ (para cima) até $z_1$ em torno de $x_1$ é $+90^\circ$, já que $\mathrm{Rot}_x(90^\circ)$ leva $(0,0,1)$ em $(0,-1,0)$. O ombro está $0{,}4$ m acima ao longo de $z_0$, então $d_1=0{,}4$.

**Passo 4, frame 2.** $z_1\parallel z_2$, então a normal comum é escolhida ao longo do braço superior: $x_2$ aponta do ombro para o cotovelo, $o_2$ é o cotovelo, $a_2=0{,}5$, $\alpha_2=0$, $d_2=0$.

**Passo 5, frame da ferramenta.** $o_3$ na ponta, $x_3$ ao longo do antebraço, $z_3\parallel z_2$: $a_3=0{,}4$, $\alpha_3=0$, $d_3=0$.

| $i$ | $a_i$ (m) | $\alpha_i$ | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0$ | $90^\circ$ | $0{,}4$ | $\theta_1$ |
| 2 | $0{,}5$ | $0$ | $0$ | $\theta_2$ |
| 3 | $0{,}4$ | $0$ | $0$ | $\theta_3$ |

Em $\theta=(0,0,0)$ o produto põe a ponta em $(0{,}9;\ 0;\ 0{,}4)$: braço horizontal, esticado ao longo de $x_0$, como os frames foram desenhados. Em $\theta=(30^\circ,45^\circ,-60^\circ)$:

$${}^0T_3=A_1A_2A_3=\begin{pmatrix}0{,}8365&0{,}2241&0{,}5&0{,}6408\\0{,}4830&0{,}1294&-0{,}8660&0{,}3700\\-0{,}2588&0{,}9659&0&0{,}6500\\0&0&0&1\end{pmatrix}.$$

### Exemplo 2: conferindo a tabela contra um produto direto

A conferência não pode reutilizar a tabela. Descreva o mesmo braço pelos movimentos físicos: girar em torno da vertical por $\theta_1$, subir $d_1$, inclinar para cima por $\theta_2$ (uma rotação em torno de $-y$), andar $a_2$ ao longo do braço, inclinar por $\theta_3$, andar $a_3$:

$$T_{\text{dir}}=\mathrm{Rot}_z(\theta_1)\,\mathrm{Trans}_z(d_1)\,\mathrm{Rot}_y(-\theta_2)\,\mathrm{Trans}_x(a_2)\,\mathrm{Rot}_y(-\theta_3)\,\mathrm{Trans}_x(a_3).$$

Nos mesmos ângulos, a última coluna dele é $(0{,}6408;\ 0{,}3700;\ 0{,}6500)$, que também bate com a fórmula da geometria plana $\big(c_1r,\ s_1r,\ d_1+a_2s_2+a_3s_{23}\big)$ com $r=a_2c_2+a_3c_{23}=0{,}7399$. As partes de rotação diferem, e $T_{\text{dir}}^{-1}\,{}^0T_3=\mathrm{Rot}_x(90^\circ)$: o frame direto mantém o eixo $y$ sobre o eixo da junta, o frame DH põe $z$ ali. Essa diferença é uma escolha de frame da ferramenta, então tem de ser a mesma em toda configuração. Com `rng = numpy.random.default_rng(5)` e 1000 configurações sorteadas por `rng.uniform(-pi, pi, (1000, 3))`, a maior entrada de $\lvert{}^0T_3-T_{\text{dir}}\mathrm{Rot}_x(90^\circ)\rvert$ foi $2{,}2\times10^{-16}$. Com o sinal de $\alpha_1$ trocado para $-90^\circ$, o mesmo teste falha na hora: $\theta_2$ positivo passa a abaixar o braço, e nos ângulos do exemplo a ponta cai na altura de $0{,}15$ m em vez de $0{,}65$ m.

### Exemplo 3: o mesmo braço na convenção modificada

Agora $z_i$ fica na junta $i$. O frame $\{1\}$ tem $z_1$ vertical (junta 1), com origem na altura do ombro. O frame $\{2\}$ tem $z_2$ no eixo do ombro, no ombro. O frame $\{3\}$ tem $z_3$ no eixo do cotovelo, no cotovelo. A ponta precisa de mais uma linha constante, já que nenhuma junta mora ali.

| $i$ | $\alpha_{i-1}$ | $a_{i-1}$ (m) | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0$ | $0$ | $0{,}4$ | $\theta_1$ |
| 2 | $90^\circ$ | $0$ | $0$ | $\theta_2$ |
| 3 | $0$ | $0{,}5$ | $0$ | $\theta_3$ |
| ferramenta | $0$ | $0{,}4$ | $0$ | $0$ |

A pose final é igual à ${}^0T_3$ clássica a menos de $2{,}2\times10^{-16}$ nas mesmas 1000 configurações. Os frames intermediários não coincidem, e essa é a diferença visível entre as convenções:

```text
frame   origem clássica           z clássico         origem modificada         z modificado
{1}     (0, 0, 0.4)  ombro        eixo do ombro      (0, 0, 0.4)               vertical (junta 1)
{2}     (0.306, 0.177, 0.754)     eixo do cotovelo   (0, 0, 0.4)  ombro        eixo do ombro
{3}     (0.641, 0.370, 0.650) ponta eixo do cotovelo (0.306, 0.177, 0.754)     eixo do cotovelo
```

O frame clássico $\{i\}$ fica na junta $i+1$, o modificado $\{i\}$ fica na junta $i$. Tudo o que é indexado por frame, como um centro de massa ou uma inércia escritos "no frame 2", muda de sentido entre as duas.

### Exemplo 4: uma junta prismática, e a mistura de convenções

Um braço do tipo SCARA tem duas juntas rotativas verticais e uma junta prismática vertical que desce a ferramenta. Suponha altura do ombro de $0{,}5$ m e elos de $0{,}4$ m e $0{,}3$ m. Na convenção clássica, $z_2$ aponta para baixo, no sentido do deslocamento, então $\alpha_2=180^\circ$, e a variável fica na coluna $d$:

| $i$ | $a_i$ (m) | $\alpha_i$ | $d_i$ (m) | $\theta_i$ |
|---|---|---|---|---|
| 1 | $0{,}4$ | $0$ | $0{,}5$ | $\theta_1$ |
| 2 | $0{,}3$ | $180^\circ$ | $0$ | $\theta_2$ |
| 3 | $0$ | $0$ | $d_3$ | $0$ |

Em $(30^\circ,45^\circ,0{,}1\text{ m})$ a ponta fica em $(0{,}4241;\ 0{,}4898;\ 0{,}4000)$, que é $\big(0{,}4c_1+0{,}3c_{12},\ 0{,}4s_1+0{,}3s_{12},\ 0{,}5-d_3\big)$. A tabela modificada, com linhas $(0,0,0{,}5,\theta_1)$, $(0;\ 0{,}4;\ 0;\ \theta_2)$, $(180^\circ;\ 0{,}3;\ d_3;\ 0)$, dá a mesma pose a menos de $1{,}1\times10^{-16}$ em 1000 configurações aleatórias do mesmo gerador.

Agora o erro comum. Aplique a tabela clássica do Exemplo 1 na fórmula modificada em $(30^\circ,45^\circ,-60^\circ)$: a ponta sai em $(0{,}5365;\ -0{,}4000;\ 0{,}6364)$, a $0{,}78$ m da verdadeira $(0{,}6408;\ 0{,}3700;\ 0{,}6500)$. A tabela modificada na fórmula clássica erra por $1{,}16$ m. Nenhum dos dois erros levanta exceção, já que os dois resultados são transformações rígidas válidas. Só uma conferência contra um cálculo independente, como no Exemplo 2, pega o erro.

## Equívocos Comuns e Armadilhas

- **"Uma tabela DH descreve o robô."** Ela descreve o robô mais uma convenção mais um conjunto de escolhas de frame. Sem a convenção, os mesmos números puseram a ponta a $0{,}78$ m de distância no Exemplo 4.
- **"$a_i$ é o comprimento do elo $i$."** É a distância entre dois eixos de junta ao longo da normal comum. O Modern Robotics observa que ele "does not necessarily correspond to the actual length of the physical link".
- **"A tabela é única."** Em eixos que se cruzam e em eixos paralelos, e na base e na ferramenta, as regras deixam escolhas. Duas tabelas corretas do mesmo braço podem diferir em sinais e zeros.
- **"Clássica e modificada diferem por um deslocamento de índice."** O índice muda, a ordem dos fatores muda e os frames vão para juntas diferentes (Exemplo 3). A pose final só bate se a linha da ferramenta for tratada.
- **"Qualquer frame pode ser um frame DH."** Um deslocamento lateral em $y$ não pode ser expresso, por isso ferramentas costumam ser presas com uma transformação fixa extra.

## Resumo

As regras de Denavit-Hartenberg põem um eixo $z$ em cada junta e um eixo $x$ em cada normal comum, o que reduz cada transformação de elo a quatro parâmetros: comprimento $a$, torção $\alpha$, deslocamento $d$ e ângulo da junta $\theta$, com $\theta$ variável numa junta rotativa e $d$ variável numa prismática. A convenção clássica põe a junta $i$ em $z_{i-1}$ e usa $\mathrm{Rot}_z\mathrm{Trans}_z\mathrm{Trans}_x\mathrm{Rot}_x$. A modificada a põe em $z_i$ e usa $\mathrm{Rot}_x\mathrm{Trans}_x\mathrm{Rot}_z\mathrm{Trans}_z$. Modern Robotics e Craig usam a forma modificada, e Murray, Li e Sastry, Spong, Siciliano e Paul a clássica, segundo as fontes acima. Num braço articulado de três juntas as duas tabelas reproduziram um produto direto de transformações a menos de $2{,}2\times10^{-16}$, enquanto uma tabela lida com a fórmula errada errou por $0{,}78$ m sem nenhum aviso.

## Documentation Links

- [Lynch and Park, Modern Robotics, preprint PDF](https://hades.mech.northwestern.edu/images/7/7f/MR.pdf): o Apêndice C atribui os frames DH, define os quatro parâmetros com a indexação modificada e mostra uma transformação que parâmetros DH não conseguem expressar.
- [Murray, Li and Sastry, A Mathematical Introduction to Robotic Manipulation, PDF](http://www.cds.caltech.edu/~murray/books/MLS/pdf/mls94-complete.pdf): o Capítulo 3, Seção 2.3, dá a transformação de elo DH clássica e relaciona os parâmetros DH ao produto de exponenciais.
- [Robotics Toolbox for Python, Denavit-Hartenberg models](https://petercorke.github.io/robotics-toolbox-python/arm_dh.html): classes de elo para DH padrão e modificado, suas transformações de elo e quais livros usam cada uma.
- [Wikipedia, Denavit-Hartenberg parameters](https://en.wikipedia.org/wiki/Denavit%E2%80%93Hartenberg_parameters): as matrizes clássica e modificada lado a lado, e os livros que usam a forma modificada.
